# agentic-engineering

Crawler TypeScript chạy lại được, do agent dò site một lần rồi chốt thành script. Các lần sau chạy bằng một lệnh, headless, không cần agent. Kế hoạch gốc: `../agentic-engineering-plan-v4.md`.

Chỉ hỗ trợ macOS.

## Cài đặt

```bash
pnpm install
```

Cần có sẵn trên máy:

- Node 22 trở lên.
- pnpm cài toàn cục (`npm i -g pnpm` hoặc `brew install pnpm`). Lệnh phải gõ được dạng `pnpm crawl ...`: sandbox của Claude Code chỉ nhận đúng dạng này, không nhận `npx pnpm ...`.
- Microsoft Edge.
- `playwright-cli` (`npm i -g @playwright/cli`).

Máy không có Edge thì đặt `AE_BROWSER_CHANNEL=chrome` cho script và thêm `--browser=chrome` cho playwright-cli.

## Dùng hằng ngày

```bash
pnpm signin <task> [--env <env>]     # mở browser, đăng nhập tay, đóng cửa sổ khi xong
pnpm crawl <task> [--env <env>]      # headless, ghi out/raw/<task>/<timestamp>.json
pnpm analyze <task>                  # đọc JSON mới nhất, ghi out/reports/<task>/
pnpm clean                           # xóa output cũ hơn 7 ngày và .playwright-cli/
```

Tham số của task truyền dạng `--tên=giá-trị`. Task có nhiều env thì bắt buộc có `--env`.

| Exit | Ý nghĩa | Xử lý |
|---|---|---|
| 0 | Thành công, qua validate | |
| 4 | Guard chặn một request ghi | Review script, không chạy tiếp |
| 2 | Hết phiên | `pnpm signin <task>` rồi chạy lại |
| 3 | Sai schema, ít hơn `minRecords`, hoặc trùng `uniqueKey` | `/web-crawl-script fix <task>` |
| 1 | Lỗi khác | Chạy lại; lặp lại thì `--headed --trace` |

Khi lỗi, màn hình chỉ in tên bước và loại lỗi. Chi tiết nằm trong `out/logs/`.

## Tạo crawler mới

1. Viết `specs/<task>.md` từ `specs/_template.md`. Spec ngắn, chỉ ghi site, thuộc tính cần lấy và mục "Dữ liệu" (phải có người duyệt). Phần còn lại agent tự suy ra khi dò.
2. `pnpm signin <task>`.
3. Trong Claude Code hoặc Cursor: `/web-crawl-script new specs/<task>.md`.
4. Review `automations/tasks/<task>.ts` trước lần chạy prod đầu tiên.

Task mẫu: `automations/tasks/quotes.ts` với `specs/quotes.md`.

`config` của task chỉ cần `site`, `startUrl` của từng env và những gì khác mặc định. Mặc định nằm trong `lib/config.ts` và không bao giờ nới lỏng guard: origin của `startUrl` luôn là app origin, request ghi bị chặn, logout bị chặn, `agentAllowed` là `false`.

## Cấu trúc

```
specs/                  spec cho người đọc, kèm sample với giá trị giả
schemas/<task>.ts       zod schema, crawl và analyze cùng dùng
automations/run.ts      pnpm crawl
automations/signin.ts   pnpm signin
automations/tasks/      config + run() của từng task
lib/config.ts           điền giá trị mặc định cho config của task
analysis/               pnpm analyze, không mở browser
lib/guard.ts            chặn request ghi (mặc định chặn) và bản bọc api
lib/session.ts          phát hiện hết phiên
lib/output.ts           validate rồi ghi file nguyên tử
lib/exit.ts             exit code và báo cáo lỗi không chứa dữ liệu
test/mock-app.ts        app + IdP giả chạy local
.claude/skills/         skill web-crawl-script và skill của playwright-cli
```

Profile đăng nhập nằm ở `~/.agentic-engineering/auth/<site>-<env>/`, ngoài repo. Coi nó như một credential.

## Test

```bash
pnpm test         # unit + e2e trên mock app local; mặc định dùng Chrome, máy chỉ có Edge thì đặt AE_BROWSER_CHANNEL=msedge
pnpm test:live    # crawl thật quotes.toscrape.com
pnpm typecheck
```

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `AE_BROWSER_CHANNEL` | `msedge` | `chrome`, hoặc `chromium` để dùng bản Playwright tải về |
| `AUTH_DIR` | `~/.agentic-engineering/auth` | Đổi thì phải sửa rule deny trong `.claude/settings.json` |
| `AE_OUT_DIR` | `./out` | |
| `AE_RETENTION_DAYS` | `7` | Dùng cho `pnpm clean` |

Kết quả các bước xác minh của Phase 1 và những gì chưa xác minh được: `docs/verification.md`.
