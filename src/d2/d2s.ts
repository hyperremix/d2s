import * as types from "./types";
import { readHeader, readHeaderData, writeHeader, writeHeaderData, fixHeader } from "./header";
import { readAttributes, writeAttributes } from "./attributes";
import { BitReader } from "../binary/bitreader";
import { BitWriter } from "../binary/bitwriter";
import { readSkills, writeSkills } from "./skills";
import * as items from "./items";
import { getConstantData } from "./constants";
import { enhanceAttributes, enhanceItems } from "./attribute_enhancer";
import { toBytes } from "./raw_bytes";

const defaultConfig = {
  extendedStash: false,
  sortProperties: true,
} as types.IConfig;

const V105 = 0x69;

/**
 * True when the save has the expansion sections (mercenary and iron golem items) after the corpse.
 * v105 saves signal this with their game mode byte (2 = Lord of Destruction, 3 = Reign of the
 * Warlock) and do not need to set the expansion status bit; older saves use the status bit.
 */
function hasExpansionSections(header: types.IHeader): boolean {
  if (header.version === V105) {
    return (header.game_mode || 0) > 1;
  }
  return header.status.expansion;
}

function reader(buffer: Uint8Array) {
  return new BitReader(buffer);
}

async function read(buffer: Uint8Array, constants?: types.IConstantData, userConfig?: types.IConfig): Promise<types.ID2S> {
  const char = {} as types.ID2S;
  const reader = new BitReader(buffer);
  const config = Object.assign(defaultConfig, userConfig);
  await readHeader(char, reader);
  //could load constants based on version here
  if (!constants) {
    constants = getConstantData(char.header.version);
  }
  await readHeaderData(char, reader, constants);
  await readAttributes(char, reader, constants);
  await readSkills(char, reader, constants);
  await items.readCharItems(char, reader, constants, config);
  await items.readCorpseItems(char, reader, constants, config);
  if (hasExpansionSections(char.header)) {
    await items.readMercItems(char, reader, constants, config);
    await items.readGolemItems(char, reader, constants, config);
  }
  if (char.header.version === V105) {
    // Sections after the item lists (the Reign of the Warlock "lf" demon section) are kept as bytes.
    reader.Align();
    char._unknown_data = char._unknown_data || {};
    char._unknown_data.v105_trailing = reader.ReadArray(Math.max(0, (reader.bits.length - reader.offset) / 8));
  }
  await enhanceAttributes(char, constants, config);
  return char;
}

async function readItem(
  buffer: Uint8Array,
  version: number,
  constants?: types.IConstantData,
  userConfig?: types.IConfig
): Promise<types.IItem> {
  const reader = new BitReader(buffer);
  const config = Object.assign(defaultConfig, userConfig);
  if (!constants) {
    constants = getConstantData(version);
  }
  const item = await items.readItem(reader, version, constants, config);
  await enhanceItems([item], constants);
  return item;
}

function writer(buffer: Uint8Array) {
  return new BitWriter();
}

async function write(data: types.ID2S, constants?: types.IConstantData, userConfig?: types.IConfig): Promise<Uint8Array> {
  const config = Object.assign(defaultConfig, userConfig);
  const writer = new BitWriter();
  writer.WriteArray(await writeHeader(data));
  if (!constants) {
    constants = getConstantData(data.header.version);
  }
  writer.WriteArray(await writeHeaderData(data, constants));
  writer.WriteArray(await writeAttributes(data, constants));
  writer.WriteArray(await writeSkills(data, constants));
  writer.WriteArray(await items.writeCharItems(data, constants, config));
  writer.WriteArray(await items.writeCorpseItem(data, constants, config));
  if (hasExpansionSections(data.header)) {
    writer.WriteArray(await items.writeMercItems(data, constants, config));
    writer.WriteArray(await items.writeGolemItems(data, constants, config));
  }
  if (data.header.version === V105 && data._unknown_data?.v105_trailing) {
    writer.WriteArray(toBytes(data._unknown_data.v105_trailing)!);
  }
  await fixHeader(writer);
  return writer.ToArray();
}

async function writeItem(
  item: types.IItem,
  version: number,
  constants?: types.IConstantData,
  userConfig?: types.IConfig
): Promise<Uint8Array> {
  const config = Object.assign(defaultConfig, userConfig);
  const writer = new BitWriter();
  if (!constants) {
    constants = getConstantData(version);
  }
  writer.WriteArray(await items.writeItem(item, version, constants, config));
  return writer.ToArray();
}

export { reader, writer, read, write, readItem, writeItem, hasExpansionSections };
