import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import * as enhancer from "../../src/d2/attribute_enhancer";
import { read, write } from "../../src/d2/d2s";
import { read as readStash } from "../../src/d2/stash";
import * as types from "../../src/d2/types";
import { constants as constants99 } from "../../src/data/versions/99_constant_data";
import { constants as constants105 } from "../../src/data/versions/105_constant_data";

const CHARS = path.join(__dirname, "../../examples/chars");
const STASH = path.join(__dirname, "../../examples/stash");

interface IStored {
  defense_rating?: number;
  current_durability?: number;
  max_durability?: number;
}

/** Armor and weapons (including socketed ones) in reading order. */
function equipment(list: types.IItem[]): types.IItem[] {
  const result = [] as types.IItem[];
  for (const item of list) {
    result.push(item, ...equipment(item.socketed_items || []));
  }
  return result.filter((item) => item.type_id === 1 || item.type_id === 3);
}

function stored(item: types.IItem): IStored {
  return { defense_rating: item.defense_rating, current_durability: item.current_durability, max_durability: item.max_durability };
}

/**
 * Reads with the attribute enhancer switched off, so the defense and durability are exactly the
 * values stored in the file (the enhancer is what fills in base values).
 */
async function withoutEnhancer<T>(action: () => Promise<T>): Promise<T> {
  const mutable = enhancer as { enhanceAttributes: unknown; enhanceItems: unknown };
  const { enhanceAttributes, enhanceItems } = enhancer;
  mutable.enhanceAttributes = async () => undefined;
  mutable.enhanceItems = async () => undefined;
  try {
    return await action();
  } finally {
    mutable.enhanceAttributes = enhanceAttributes;
    mutable.enhanceItems = enhanceItems;
  }
}

const CHARACTERS = [
  { file: "99/Barbarian.d2s", constants: constants99 },
  { file: "99/Assassin.d2s", constants: constants99 },
  { file: "105/Roka.d2s", constants: constants105 },
] as const;

describe("defense and durability stored in a save", () => {
  for (const { file, constants } of CHARACTERS) {
    const buffer = fs.readFileSync(path.join(CHARS, file));

    it(`When reading ${file}, then every armor and weapon keeps the defense and durability stored in the file`, async () => {
      // Arrange
      const raw = equipment((await withoutEnhancer(() => read(buffer, constants))).items);

      // Act
      const enhanced = equipment((await read(buffer, constants)).items);

      // Assert
      expect(enhanced.length).to.be.greaterThan(0);
      expect(enhanced.map(stored)).to.deep.eq(raw.map(stored));
    });

    it(`When writing ${file} and reading it again, then the defense and durability are the stored ones`, async () => {
      // Arrange
      const raw = equipment((await withoutEnhancer(() => read(buffer, constants))).items);
      const save = await read(buffer, constants);

      // Act
      const reread = await read(await write(save, constants), constants);

      // Assert
      expect(equipment(reread.items).map(stored)).to.deep.eq(raw.map(stored));
    });
  }

  it("When an item is damaged or has a non-base defense in the file, then it keeps those stored values", async () => {
    // Arrange
    const buffer = fs.readFileSync(path.join(CHARS, "99/Barbarian.d2s"));
    const raw = equipment((await withoutEnhancer(() => read(buffer, constants99))).items);
    const damaged = raw.filter((item) => item.max_durability! > 0 && item.current_durability! < item.max_durability!);
    const nonBaseDefense = raw.filter((item) => {
      const base = constants99.armor_items[item.type]?.maxac;
      return item.type_id === 1 && base !== undefined && item.defense_rating !== base;
    });

    // Act
    const enhanced = equipment((await read(buffer, constants99)).items);

    // Assert
    expect(damaged.length, "damaged items in the fixture").to.be.greaterThan(0);
    expect(nonBaseDefense.length, "items with a non-base defense in the fixture").to.be.greaterThan(0);
    const byIndex = (list: types.IItem[]) => list.map((item) => enhanced[raw.indexOf(item)]);
    expect(byIndex(damaged).map((item) => item.current_durability)).to.deep.eq(damaged.map((item) => item.current_durability));
    expect(byIndex(damaged).map((item) => item.max_durability)).to.deep.eq(damaged.map((item) => item.max_durability));
    expect(byIndex(nonBaseDefense).map((item) => item.defense_rating)).to.deep.eq(nonBaseDefense.map((item) => item.defense_rating));
  });

  it("When an item has a maximum durability of 0 in the file but a base durability, then it is not given the base durability", async () => {
    // Arrange
    const buffer = fs.readFileSync(path.join(CHARS, "99/Assassin.d2s"));
    const raw = equipment((await withoutEnhancer(() => read(buffer, constants99))).items);
    const baseDurability = (item: types.IItem) => (constants99.armor_items[item.type] || constants99.weapon_items[item.type]).durability;
    const indestructible = raw.filter((item) => item.max_durability === 0 && baseDurability(item) > 0);

    // Act
    const enhanced = equipment((await read(buffer, constants99)).items);

    // Assert
    expect(indestructible.length, "indestructible items in the fixture").to.be.greaterThan(0);
    for (const item of indestructible) {
      const result = enhanced[raw.indexOf(item)];
      expect(result.max_durability, `${item.type} max durability`).to.eq(0);
      expect(result.current_durability, `${item.type} current durability`).to.eq(undefined);
    }
  });

  it("When reading a modern shared stash, then every armor and weapon keeps the defense and durability stored in the file", async () => {
    // Arrange
    const buffer = fs.readFileSync(path.join(STASH, "SharedStashSoftCoreV2_0x63.d2i"));
    const flatten = (stash: types.IStash) => equipment(([] as types.IItem[]).concat(...stash.pages.map((page) => page.items)));
    const raw = flatten(await withoutEnhancer(() => readStash(buffer, constants99, null)));

    // Act
    const enhanced = flatten(await readStash(buffer, constants99, null));

    // Assert
    expect(enhanced.length).to.be.greaterThan(0);
    expect(raw.some((item) => item.max_durability === 0), "an indestructible item in the fixture").to.eq(true);
    expect(enhanced.map(stored)).to.deep.eq(raw.map(stored));
  });
});
