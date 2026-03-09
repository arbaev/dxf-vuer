import fs from "fs";

/** Inline binary files as ArrayBuffer via `?arraybuffer` import suffix. */
export function arraybufferPlugin() {
  return {
    name: "vite-plugin-arraybuffer",
    transform(_code: string, id: string) {
      const [filePath, query] = id.split("?");
      if (query !== "arraybuffer") return null;
      const buffer = fs.readFileSync(filePath);
      const base64 = buffer.toString("base64");
      return {
        code: [
          `const b=atob("${base64}");`,
          `const u=new Uint8Array(b.length);`,
          `for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);`,
          `export default u.buffer;`,
        ].join(""),
        map: null,
      };
    },
  };
}
