# Spec: <task>

Tên file là tên task: `specs/<task>.md` đi với `automations/tasks/<task>.ts` và `schemas/<task>.ts`.

## Mục tiêu

Cần data gì, ai dùng kết quả, dùng để làm gì.

## Site & môi trường

| Env | URL bắt đầu | Ghi chú |
|---|---|---|
| uat | | |
| prod | | |

## Dữ liệu & phê duyệt

Agent dừng nếu mục này còn trống.

- Phân loại dữ liệu:
- Có PII không, gồm những gì:
- Người phê duyệt:
- Ngày phê duyệt:
- Env được phép cho agent dò (dữ liệu trên env này sẽ đi qua LLM):

## Auth

- Cách đăng nhập (SSO nào, có MFA không):
- Tín hiệu hết phiên: URL trang đăng nhập hoặc origin của IdP, và ô nhập hay màn chọn tài khoản hiện ra ở đó:
- App giữ token ở đâu: cookie, sessionStorage hay localStorage:

## Input

Tham số của mỗi lần chạy, truyền dạng `--tên=giá-trị`. Ví dụ khoảng ngày, mã ticket.

## Output schema

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| | | | |

- Số bản ghi tối thiểu (`minRecords`):
- Trường khóa duy nhất (`uniqueKey`):

Mẫu với giá trị giả: `specs/<task>.sample.json`.

## Phân trang & rate limit

- Cách sang trang:
- Số trang tối đa (`maxPages`):
- Delay tối thiểu giữa các request (`rate.minDelayMs`):

## Origin

Agent điền sau khi dò: mọi origin thấy trong network log.

| Origin | Loại (app / IdP / telemetry) |
|---|---|
| | |

## Allowlist request ngoài GET/HEAD/OPTIONS

Để trống nếu crawler chỉ đọc bằng GET.

| Method | URL | Điều kiện |
|---|---|---|
| | | |

Với GraphQL: ghi `operationName` và chỉ cho `query`. Persisted query chỉ gửi hash thì ghi hash, sau khi đã xác nhận hash đó là một `query`.

## URL cấm

GET có tác dụng phụ đã biết (logout, kích hoạt export). Logout bị chặn sẵn.

## Tiêu chí xong

- `pnpm crawl <task>` chạy headless ra exit 0.
-
