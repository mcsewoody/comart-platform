import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeletedDocumentError, tag, uploadOne, type ImportFile } from "./upload-one";
import { api } from "./api";

/* uploadOne 有三條路（秒傳／已存在／一般 PUT）外加重試與回退，是整包最會出事的
   一段。這裡把 api 與 fetch 都換掉，只驗流程決策，不碰網路。*/
vi.mock("./api", () => ({
  api: {
    initPdUpload: vi.fn(),
    completePdUpload: vi.fn(),
  },
}));

const initPdUpload = vi.mocked(api.initPdUpload);
const completePdUpload = vi.mocked(api.completePdUpload);

function file(name = "X1.pdf", size = 1024): ImportFile {
  return {
    file: new File([new Uint8Array(size)], name, { type: "application/pdf" }),
    dataset: "mfg",
    relativePath: `OwnProduct/素亦/${name}`,
    sha256: "a".repeat(64),
    status: tag("u_st_pending"),
  };
}

function storageResponse(status: number, body = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

const noop = () => {};
const signal = new AbortController().signal;

beforeEach(() => {
  vi.clearAllMocks();
  completePdUpload.mockResolvedValue({ duplicate: false, documentId: "doc-1" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("uploadOne", () => {
  const tomb = { sha256: "a".repeat(64), relativePath: "OwnProduct/素亦/X1.pdf", title: "X1", deletedAt: "2026-10-01T00:00:00Z", deletedByName: "管理者" };

  it("曾被刪除：伺服器擋下就丟 DeletedDocumentError，不碰 storage、不回報完成", async () => {
    initPdUpload.mockResolvedValue({ duplicate: false, deleted: true, tombstone: tomb });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(uploadOne(file(), noop, signal)).rejects.toBeInstanceOf(DeletedDocumentError);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(completePdUpload).not.toHaveBeenCalled();
  });

  it("還原：restore 要同時送到 initUpload 與 completeUpload", async () => {
    initPdUpload.mockResolvedValue({ duplicate: false, storageExists: true, storagePath: "aa/x/source.pdf" });
    await expect(uploadOne({ ...file(), restore: true }, noop, signal)).resolves.toBe("completed");
    expect(initPdUpload.mock.calls[0][0]).toMatchObject({ restore: true });
    expect(completePdUpload.mock.calls[0][0]).toMatchObject({ restore: true });
  });

  it("一般上傳不送 restore（伺服器看到 restore 會要求 admin）", async () => {
    initPdUpload.mockResolvedValue({ duplicate: false, storageExists: true, storagePath: "aa/x/source.pdf" });
    await uploadOne(file(), noop, signal);
    expect(initPdUpload.mock.calls[0][0]).not.toHaveProperty("restore");
    expect(completePdUpload.mock.calls[0][0]).not.toHaveProperty("restore");
  });

  it("initUpload 之後才被刪掉：completeUpload 擋下也要丟 DeletedDocumentError", async () => {
    initPdUpload.mockResolvedValue({ duplicate: false, storageExists: true, storagePath: "aa/x/source.pdf" });
    completePdUpload.mockResolvedValue({ duplicate: false, deleted: true, tombstone: tomb, documentId: "" });
    await expect(uploadOne(file(), noop, signal)).rejects.toBeInstanceOf(DeletedDocumentError);
  });

  it("秒傳：後端說這個 sha256 已經有了，就不碰 storage", async () => {
    initPdUpload.mockResolvedValue({ duplicate: true });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(uploadOne(file(), noop, signal)).resolves.toBe("duplicate");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(completePdUpload).not.toHaveBeenCalled();
  });

  it("檔案已在 storage：跳過上傳，但仍要回報完成（否則資料庫不會有這筆）", async () => {
    initPdUpload.mockResolvedValue({
      duplicate: false,
      storagePath: "mfg/aaa.pdf",
      storageExists: true,
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(uploadOne(file(), noop, signal)).resolves.toBe("completed");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(completePdUpload).toHaveBeenCalledTimes(1);
  });

  it("暫時性錯誤（503）會重試，而且每次都重新要一張簽章網址", async () => {
    vi.useFakeTimers();
    initPdUpload.mockResolvedValue({
      duplicate: false,
      storagePath: "mfg/aaa.pdf",
      signedUrl: "https://storage.example/put",
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(storageResponse(503, "slow down"))
      .mockResolvedValueOnce(storageResponse(200));
    vi.stubGlobal("fetch", fetchSpy);

    const pending = uploadOne(file(), noop, signal);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe("completed");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // 🔴 簽章網址會過期，所以重試一定要重新 init，不能沿用上一輪那張
    expect(initPdUpload).toHaveBeenCalledTimes(2);
  });

  it("非暫時性錯誤（400）立刻放棄，不浪費兩次重試", async () => {
    initPdUpload.mockResolvedValue({
      duplicate: false,
      storagePath: "mfg/aaa.pdf",
      signedUrl: "https://storage.example/put",
    });
    const fetchSpy = vi.fn().mockResolvedValue(storageResponse(400, '{"message":"bad request"}'));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(uploadOne(file(), noop, signal)).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("storage 回『已存在』視為成功 —— 上一次其實傳成功了，只是回應掉了", async () => {
    initPdUpload.mockResolvedValue({
      duplicate: false,
      storagePath: "mfg/aaa.pdf",
      signedUrl: "https://storage.example/put",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(storageResponse(409, "The resource already exists")),
    );

    await expect(uploadOne(file(), noop, signal)).resolves.toBe("completed");
    expect(completePdUpload).toHaveBeenCalledTimes(1);
  });

  it("413 會換成看得懂的『檔案太大』訊息，而不是丟一個裸的狀態碼", async () => {
    initPdUpload.mockResolvedValue({
      duplicate: false,
      storagePath: "mfg/aaa.pdf",
      signedUrl: "https://storage.example/put",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(storageResponse(413, "EntityTooLarge")));

    await expect(uploadOne(file("big.pdf", 2048), noop, signal)).rejects.toThrow(/KB|MB/);
  });

  it("中止訊號會一路傳到 api 與 storage 的請求上", async () => {
    const controller = new AbortController();
    initPdUpload.mockResolvedValue({
      duplicate: false,
      storagePath: "mfg/aaa.pdf",
      signedUrl: "https://storage.example/put",
    });
    const fetchSpy = vi.fn().mockResolvedValue(storageResponse(200));
    vi.stubGlobal("fetch", fetchSpy);

    await uploadOne(file(), noop, controller.signal);

    expect(initPdUpload).toHaveBeenCalledWith(expect.anything(), controller.signal);
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
    expect(completePdUpload).toHaveBeenCalledWith(expect.anything(), controller.signal);
  });

  it("回報狀態時給的是 i18n key，不是已經翻好的字", async () => {
    initPdUpload.mockResolvedValue({
      duplicate: false,
      storagePath: "mfg/aaa.pdf",
      signedUrl: "https://storage.example/put",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(storageResponse(200)));
    const seen: string[] = [];

    await uploadOne(file(), (status) => seen.push(status.key), signal);

    expect(seen).toContain("u_st_uploading");
    expect(seen.every((key) => /^u_st_/.test(key))).toBe(true);
  });
});
