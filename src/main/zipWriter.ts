import { createReadStream, createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { once } from 'node:events'
import { crc32 } from 'node:zlib'

/**
 * Writes a minimal "stored" (uncompressed) zip. APKs are already compressed,
 * so storing is fast and loses nothing. Limited to 4 GB (no ZIP64); callers
 * check the size first.
 */
export async function writeStoredZip(
  dest: string,
  files: Array<{ name: string; path: string }>,
  signal?: AbortSignal
): Promise<void> {
  const out = createWriteStream(dest)
  let offset = 0
  const central: Buffer[] = []
  const write = async (b: Buffer): Promise<void> => {
    if (!out.write(b)) await once(out, 'drain')
    offset += b.length
  }
  try {
    for (const f of files) {
      signal?.throwIfAborted()
      const size = (await stat(f.path)).size
      let crc = 0
      for await (const chunk of createReadStream(f.path, { signal })) crc = crc32(chunk as Buffer, crc)
      const name = Buffer.from(f.name, 'utf8')
      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0)
      local.writeUInt16LE(20, 4) // version needed
      local.writeUInt16LE(0x0800, 6) // UTF-8 names
      local.writeUInt16LE(0, 8) // stored
      local.writeUInt32LE(0, 10) // time/date
      local.writeUInt32LE(crc >>> 0, 14)
      local.writeUInt32LE(size, 18)
      local.writeUInt32LE(size, 22)
      local.writeUInt16LE(name.length, 26)
      local.writeUInt16LE(0, 28)
      const headerOffset = offset
      await write(local)
      await write(name)
      for await (const chunk of createReadStream(f.path, { signal })) await write(chunk as Buffer)

      const c = Buffer.alloc(46)
      c.writeUInt32LE(0x02014b50, 0)
      c.writeUInt16LE(20, 4)
      c.writeUInt16LE(20, 6)
      c.writeUInt16LE(0x0800, 8)
      c.writeUInt16LE(0, 10)
      c.writeUInt32LE(0, 12)
      c.writeUInt32LE(crc >>> 0, 16)
      c.writeUInt32LE(size, 20)
      c.writeUInt32LE(size, 24)
      c.writeUInt16LE(name.length, 28)
      c.writeUInt32LE(headerOffset, 42)
      central.push(c, name)
    }
    const cdStart = offset
    for (const b of central) await write(b)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(files.length, 8)
    end.writeUInt16LE(files.length, 10)
    end.writeUInt32LE(offset - cdStart, 12)
    end.writeUInt32LE(cdStart, 16)
    await write(end)
  } finally {
    out.end()
    await once(out, 'close')
  }
}
