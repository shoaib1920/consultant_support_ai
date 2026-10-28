import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setRepo } from "@/server/db";
import { MemoryRepo } from "@/server/db/memory";
import { deleteFile, getFile, putFile, storageMode } from "@/server/storage";

describe("Firestore file storage (free Spark plan, no Firebase Storage)", () => {
  const repo = new MemoryRepo();
  beforeAll(() => {
    process.env.FILE_STORAGE = "firestore";
    setRepo(repo);
  });
  afterAll(() => {
    delete process.env.FILE_STORAGE;
  });

  it("stores large files as encrypted chunks under the 1 MiB document limit and restores them byte-for-byte", async () => {
    expect(storageMode()).toBe("firestore");
    const bytes = crypto.randomBytes(1_500_000);
    await putFile("orgs/org_t/students/s1/d1/passport.pdf", bytes, "application/pdf");
    const chunks = await repo.list<{ data: string; organizationId: string }>("files");
    expect(chunks.length).toBe(3);
    for (const c of chunks) {
      expect(c.organizationId).toBe("org_t");
      expect(c.data.length).toBeLessThan(1_000_000);
    }
    // encrypted at rest: the raw bytes do not appear in the stored data
    expect(Buffer.from(chunks[0].data, "base64").subarray(28, 60).equals(bytes.subarray(0, 32))).toBe(false);
    expect((await getFile("orgs/org_t/students/s1/d1/passport.pdf"))!.equals(bytes)).toBe(true);
    await deleteFile("orgs/org_t/students/s1/d1/passport.pdf");
    expect(await repo.list("files")).toHaveLength(0);
    expect(await getFile("orgs/org_t/students/s1/d1/passport.pdf")).toBeNull();
  });
});
