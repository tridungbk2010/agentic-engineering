---
name: web-crawl-script
description: Tạo hoặc sửa một crawler TypeScript chạy lại được bằng `pnpm crawl <task>`, cho việc lấy data lặp lại trên web. Agent dò site bằng playwright-cli có người giám sát rồi chốt thành script. Chỉ dùng khi người dùng gọi `/web-crawl-script new <spec>` hoặc `/web-crawl-script fix <task>`.
argument-hint: new <spec> | fix <task>
disable-model-invocation: true
---

# web-crawl-script

Phần chữ người dùng gõ sau tên lệnh cho biết việc cần làm:

- `new specs/<task>.md`: tạo crawler mới từ spec.
- `fix <task>`: sửa crawler đang vỡ.

Thiếu hoặc không rõ thì hỏi lại, không đoán.

Skill này là quy trình cho agent. Thứ chạy hằng ngày là `pnpm crawl <task>`, không cần agent.

## 1. Khi nào dùng

Việc lặp lại trên web cần lấy data. Việc chỉ làm một lần thì dùng playwright-cli trực tiếp, không cần skill này.

## 2. Trước khi dò

Đọc `specs/<task>.md`. Spec do người điền và chỉ có: site, mục đích, thuộc tính cần lấy, tham số, dữ liệu (loại, PII, người duyệt, env agent được dò), đăng nhập. Dừng và báo người dùng nếu:

- mục "Dữ liệu" còn trống (thiếu người duyệt hoặc env agent được dò), hoặc
- env định dò không nằm trong "Agent được dò trên".

Mọi thứ còn lại agent tự suy ra khi dò rồi ghi vào code, không bắt người điền: kiểu và độ bắt buộc của trường, `uniqueKey`, `minRecords`, phân trang, `maxPages`, `rate`, origin, `writeAllowlist`, `blockUrls`, dấu hiệu hết phiên. Nếu không chắc (ví dụ thiếu bản ghi so với trên màn hình), hỏi người dùng.

Chỉ dò và chạy trên env có `agentAllowed: true` trong `config`. `run.ts` cũng từ chối env khác khi chạy từ shell của agent.

## 3. Khám phá

Người dùng phải đăng nhập trước bằng `pnpm signin <task>`. Sau đó mở trình duyệt có cửa sổ, dùng chung profile với script:

```bash
playwright-cli open <startUrl> --headed --browser=msedge --profile="$HOME/.agentic-engineering/auth/<site>-<env>"
```

Việc đầu tiên sau khi mở là bật chặn request ghi. Lệnh `route` của CLI không lọc được theo method, nên dùng `run-code` (điền origin của IdP lấy từ spec, để SSO vẫn làm mới được phiên):

```bash
playwright-cli run-code "async page => { const idp = ['https://<idp-origin>']; await page.context().route('**/*', r => { const q = r.request(); return ['GET','HEAD','OPTIONS'].includes(q.method()) || idp.includes(new URL(q.url()).origin) ? r.continue() : r.abort('blockedbyclient') }); return 'guard on' }"
```

Trong lúc dò:

- Dùng `snapshot` và `requests`; ưu tiên tìm API XHR/GraphQL mà trang đang gọi.
- Không bấm submit, save, delete, approve.
- Gặp trang đăng nhập thì dừng, `playwright-cli close`, và nhờ người dùng chạy `pnpm signin <task>`. Không nhập credential.
- Liệt kê mọi origin thấy trong `requests`, xếp vào `appOrigins` (app và API của nó), `idpOrigins`, `dropOrigins` (telemetry). Ghi vào `config` của task, không ghi vào spec.

Cú pháp các lệnh playwright-cli: xem skill `playwright-cli` (cài bằng `playwright-cli install --skills`), không chép lại ở đây.

## 4. Chốt script

Tạo `automations/tasks/<task>.ts`, lấy `automations/tasks/quotes.ts` làm mẫu. File export `config` (kiểu `TaskConfigInput`) và `run()`.

`config` chỉ ghi `site`, `startUrl` của từng env và những trường khác mặc định. `lib/config.ts` tự điền phần còn lại, mọi mặc định đều không nới lỏng guard:

- origin của `startUrl` luôn nằm trong `appOrigins`; chỉ ghi thêm origin API khác.
- `idpOrigins`, `dropOrigins`, `writeAllowlist`, `allowWebSocket`: rỗng.
- `agentAllowed`: `false`. Env agent được dò phải ghi `agentAllowed: true`.
- `blockUrls`: luôn có `/logout|signout/i`; chỉ ghi thêm mẫu khác.
- `minRecords: 1`, `maxPages: 20`, `rate.minDelayMs: 1000`, `timeoutMs: 120_000`.
- `session.loginInput`: ô email, password hoặc username thông dụng. `session.loginUrl` chỉ cần khi app có trang login riêng, không qua IdP.

Không chép lại giá trị mặc định vào task.

- Chỉ dùng `page` và `api` do `run.ts` truyền vào. Không gọi `fetch` của Node, `page.request`, `context.request` hay `request.newContext`: các đường này không qua guard.
- Gọi API bằng `api.json(url)`. Nó dùng cookie của trình duyệt, tự giãn cách theo `rate`, và tự nhận ra hết phiên.
- App dùng bearer token: để trang tự gọi rồi bắt bằng `page.waitForResponse`, hoặc gọi `fetch` trong `page.evaluate`. Không lấy token ra Node, không ghi token ra file hay log.
- Locator: `getByRole` / `getByLabel` / `getByTestId`. Không dùng ref (`e15`) từ snapshot.
- Chờ UI bằng `waitForResponse` hoặc `locator.waitFor`. Không `sleep` cố định, không tự thêm delay giữa các request.
- Mỗi trang dữ liệu gọi `nextPage()` một lần; vượt `maxPages` thì run dừng với exit 1.
- `step('tên bước')` chỉ nhận chữ tĩnh, không nhận dữ liệu.
- Request ghi mà crawler thật sự cần (ví dụ POST tìm kiếm) phải nằm trong `writeAllowlist` và được ghi trong spec. GraphQL: theo `operationName` của một `query`, hoặc theo `sha256Hash` với persisted query.
- `locale` chỉ đổi `navigator.language` và Accept-Language. App lưu ngôn ngữ theo hồ sơ user thì phải cố định ở đó.

## 5. Schema và sample

- `schemas/<task>.ts` export `recordSchema` (zod), sinh từ mục "Thuộc tính cần lấy" của spec (agent chọn tên trường camelCase và kiểu). Trường không có trong schema sẽ bị bỏ khi ghi file.
- `specs/<task>.sample.json` chỉ chứa giá trị giả. Không chép tên người, mã nhân viên hay nội dung thật từ site.
- Nếu cần báo cáo: `analysis/tasks/<task>.ts` export `analyze(records, meta)`, chỉ trả số liệu tổng hợp.

## 6. Định nghĩa "xong"

1. `playwright-cli close` (profile chỉ mở được ở một nơi).
2. `pnpm crawl <task> --env <env>` chạy headless ra exit 0: qua zod, đạt `minRecords`, không trùng `uniqueKey`.
   Gõ đúng dạng `pnpm crawl ...` từ thư mục gốc của project, không kèm `cd`, `> file` hay `$(...)`. Sandbox chỉ cho lệnh ở đúng dạng này đọc profile đăng nhập.
3. Xóa `.playwright-cli/` (chứa snapshot và response thật).
4. Báo người dùng review `automations/tasks/<task>.ts`, nhất là `writeAllowlist` và phân loại origin, trước lần chạy prod đầu tiên.

Nếu crawl ra exit 2 ngay sau khi dò: cookie ghi trong 30 giây cuối của phiên playwright-cli có thể chưa kịp lưu. Nhờ người dùng chạy lại `pnpm signin <task>`.

## 7. Bảo mật

- Không đọc `~/.agentic-engineering/`, `out/raw`, `out/traces`, `out/logs`, kể cả bằng `cat`, `node -e` hay python.
- Task module không `console.log` dữ liệu. Không in data thật ra chat. Không lưu credential.
- Không chạy `pnpm crawl` với `--trace`: trace chứa request, response và token.

## 8. Sửa khi vỡ (`fix <task>`)

Dựa vào exit code và báo cáo lỗi mà `pnpm crawl` in ra (bước, loại lỗi, path + code của zod). Không đọc `out/logs` để tìm nguyên nhân.

| Exit | Việc cần làm |
|---|---|
| 2 | Hết phiên. Nhờ người dùng chạy `pnpm signin <task>`. Không sửa script. |
| 3 | Đối chiếu `schemas/<task>.ts` và `specs/<task>.sample.json`, dò lại trang trên env được duyệt (mục 3), sửa mapping hoặc locator. |
| 4 | Script đã thử một request ghi. Tìm chỗ gây ra và bỏ nó. Chỉ thêm vào `writeAllowlist` khi spec cho phép và đã hỏi người dùng. |
| 1 | Chạy lại một lần. Lặp lại thì dò lại trang để tìm thay đổi. |

Chạy lại `pnpm crawl <task>` cho đến khi ra exit 0, rồi làm các bước ở mục 6.
