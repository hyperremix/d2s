import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { read, write } from "../../src/d2/d2s";
import { constants } from "../../src/data/versions/105_constant_data";
import * as types from "../../src/d2/types";

const FIXTURES = path.join(__dirname, "../../examples/chars/105");
const FIXTURE_FILES = fs.readdirSync(FIXTURES).filter((file) => file.endsWith(".d2s"));
const HEADER_LENGTH = 833;

function load(file: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES, file));
}

/** The save checksum: computed over the whole file with the checksum field zeroed. */
function checksum(bytes: Uint8Array): number {
  const copy = Buffer.from(bytes);
  copy.writeUInt32LE(0, 12);
  let sum = 0;
  for (let i = 0; i < copy.length; i++) {
    sum = (((sum << 1) | (sum >>> 31)) + copy[i]) >>> 0;
  }
  return sum;
}

function expectValidFile(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  expect(buffer.readUInt32LE(8), "file size field").to.eq(buffer.length);
  expect(buffer.readUInt32LE(12), "checksum field").to.eq(checksum(buffer));
}

/** Offset of the mercenary section ("jf" followed by an item list or the "kf" golem section). */
function mercSectionOffset(bytes: Uint8Array): number {
  const buffer = Buffer.from(bytes);
  const withItems = buffer.lastIndexOf(Buffer.from("jfJM", "ascii"));
  return withItems >= 0 ? withItems : buffer.lastIndexOf(Buffer.from("jfkf", "ascii"));
}

describe("d2s v105 (Reign of the Warlock)", () => {
  it("should have fixtures", () => {
    expect(FIXTURE_FILES.length).to.be.greaterThan(0);
  });

  for (const file of FIXTURE_FILES) {
    it(`should write ${file} back byte-identical`, async () => {
      const buffer = load(file);
      expectValidFile(buffer);

      const save = await read(buffer, constants);
      const output = await write(save, constants);

      expect(Buffer.from(output).equals(buffer)).to.eq(true);
    });
  }

  it("should read the expansion sections from the game mode byte, not the status bit", async () => {
    const classic = await read(load("barbclassic_v105.d2s"), constants);
    const lod = await read(load("barbexp_v105.d2s"), constants);
    const rotw = await read(load("barbrotw_v105.d2s"), constants);

    expect([classic.header.game_mode, lod.header.game_mode, rotw.header.game_mode]).to.deep.eq([1, 2, 3]);
    expect([classic.header.status.expansion, lod.header.status.expansion, rotw.header.status.expansion]).to.deep.eq([false, false, false]);
    expect(classic.merc_items).to.eq(undefined);
    expect(lod.merc_items).to.deep.eq([]);
    expect(rotw.merc_items).to.deep.eq([]);
  });

  it("should keep the bytes after the golem section", async () => {
    const save = await read(load("Warlock_v105.d2s"), constants);

    const trailing = Buffer.from(save._unknown_data!.v105_trailing!);

    expect(trailing.subarray(0, 4).toString("latin1")).to.eq("\x01\x00lf");
  });

  it("should write a moved, removed and added item with a valid size and checksum and leave the other sections alone", async () => {
    const original = load("ChaosSC.d2s");
    const save = await read(original, constants);
    const donor = await read(load("Roka.d2s"), constants);
    const removedIndex = save.items.findIndex((item) => item.location_id === 0 && item.alt_position_id === 1 && !item.simple_item && !item.socketed_items?.length);
    const removed = save.items[removedIndex];
    const added = donor.items.find((item) => item.location_id === 0 && item.alt_position_id === 1 && !item.simple_item && item.inv_width === 1 && item.inv_height === 1) as types.IItem;
    expect(removed, "an inventory item").to.not.eq(undefined);
    expect(added, "a 1x1 inventory item").to.not.eq(undefined);
    const removedTypeCountBefore = save.items.filter((item) => item.type === removed.type).length;
    save.items.splice(removedIndex, 1);
    save.items.push({ ...added, position_x: removed.position_x, position_y: removed.position_y });

    const output = await write(save, constants);
    const reread = await read(output, constants);

    expectValidFile(output);
    expect(reread.items.length).to.eq(save.items.length);
    const countOfType = (list: types.IItem[], type: string) => list.filter((item) => item.type === type).length;
    expect(removed.type).to.not.eq(added.type);
    expect(countOfType(reread.items, removed.type)).to.eq(removedTypeCountBefore - 1);
    expect(countOfType(reread.items, added.type)).to.eq(countOfType(save.items, added.type));
    expect(reread.items[reread.items.length - 1]).to.deep.include({ type: added.type, id: added.id, position_x: removed.position_x, position_y: removed.position_y });
    expect(reread.merc_items.length).to.eq(save.merc_items.length);
    expect(Buffer.from(output.subarray(16, HEADER_LENGTH)).equals(original.subarray(16, HEADER_LENGTH)), "header").to.eq(true);
    const originalTail = original.subarray(mercSectionOffset(original));
    const outputTail = Buffer.from(output.subarray(mercSectionOffset(output)));
    expect(outputTail.equals(originalTail), "mercenary, golem and lf sections").to.eq(true);
  });

  it("should write a changed header field and keep every other header byte", async () => {
    const original = load("Warlock_v105.d2s");
    const save = await read(original, constants);
    save.header.level = 2;

    const output = Buffer.from(await write(save, constants));

    expectValidFile(output);
    const changed = [] as number[];
    for (let i = 16; i < output.length; i++) {
      if (output[i] !== original[i]) changed.push(i);
    }
    expect(changed).to.deep.eq([27]);
    expect(output[27]).to.eq(2);
  });

  it("should refuse to write a v105 save without its header bytes", async () => {
    const save = await read(load("Warlock_v105.d2s"), constants);
    delete save._unknown_data!.v105_header;

    let error: Error | undefined;
    try {
      await write(save, constants);
    } catch (e) {
      error = e as Error;
    }

    expect(error?.message).to.contain("without the header bytes");
  });

  it("should write a save whose kept bytes went through JSON", async () => {
    const original = load("ChaosSC.d2s");
    const save = JSON.parse(JSON.stringify(await read(original, constants))) as types.ID2S;

    const output = await write(save, constants);

    expect(Buffer.from(output).equals(original)).to.eq(true);
  });
});
