# Spec: servicenow-incident

**Trạng thái: bản nháp. Chưa được dò, chưa có task module.** Phase 0 (plan mục 9) chưa ra "go", nên agent phải dừng ở mục "Dữ liệu & phê duyệt". Các chỗ ghi "cần xác nhận" là câu hỏi còn mở ở plan mục 11.

## Mục tiêu

Lấy từ ServiceNow, cho mỗi incident:

- thông tin incident,
- banker đã log incident đó,
- notes kèm theo.

Kết quả cần có là **pNumber của banker**. pNumber là mã nhân viên dạng chữ `p` và sáu chữ số, ví dụ giả `p000123`.

Ai dùng kết quả, dùng để làm gì: cần xác nhận.

## Site & môi trường

| Env | URL bắt đầu | Ghi chú |
|---|---|---|
| uat | cần xác nhận | Có instance sub-prod cho agent dò không? |
| prod | cần xác nhận | Chỉ người chạy, agent không dò |

## Dữ liệu & phê duyệt

Agent dừng nếu mục này còn trống.

- Phân loại dữ liệu:
- Có PII không, gồm những gì: có. Tên banker, pNumber, và nội dung notes (có thể chứa thông tin khách hàng).
- Người phê duyệt:
- Ngày phê duyệt:
- Env được phép cho agent dò (dữ liệu trên env này sẽ đi qua LLM):

## Auth

- Cách đăng nhập: SSO của công ty, cần xác nhận IdP và MFA.
- Tín hiệu hết phiên: cần xác nhận sau Phase 0c.
- App giữ token ở đâu: cần xác nhận sau Phase 0c.

## Input

Đề xuất, cần xác nhận:

- `--from=YYYY-MM-DD`, `--to=YYYY-MM-DD`: khoảng ngày mở incident.
- Hoặc `--number=INC0000000`: một incident cụ thể.

## Output schema

Đề xuất, cần xác nhận từng trường.

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| number | string | có | Số incident, dạng `INC` và các chữ số |
| shortDescription | string | có | |
| state | string | có | |
| openedAt | string (ISO 8601) | có | |
| bankerName | string | có | Người log incident: trường Caller hay Opened by? |
| bankerPNumber | string, khớp `^p\d{6}$` | có | Lấy từ hồ sơ user của người log, hay tách ra từ nội dung notes? |
| notes | mảng `{ type, createdAt, author, text }` | có, có thể rỗng | Additional comments, Work notes, hay cả hai? |

- Số bản ghi tối thiểu (`minRecords`): 1.
- Trường khóa duy nhất (`uniqueKey`): `number`.

Mẫu với giá trị giả: `specs/servicenow-incident.sample.json`.

## Phân trang & rate limit

- Cách sang trang: cần dò. Nếu được dùng REST Table API của ServiceNow thì phân trang bằng `sysparm_limit` và `sysparm_offset`.
- Số trang tối đa (`maxPages`): cần xác nhận.
- Delay tối thiểu giữa các request (`rate.minDelayMs`): đề xuất 1000.

## Origin

Agent điền sau khi dò.

| Origin | Loại (app / IdP / telemetry) |
|---|---|
| | |

## Allowlist request ngoài GET/HEAD/OPTIONS

Để trống cho đến khi dò xong. Giao diện ServiceNow gọi nhiều request POST nội bộ; nếu crawler cần cái nào thì ghi rõ từng cái ở đây và hỏi người phê duyệt.

| Method | URL | Điều kiện |
|---|---|---|
| | | |

## URL cấm

Logout bị chặn sẵn. Bổ sung sau khi dò: các URL lưu, cập nhật hay export record.

## Tiêu chí xong

- `pnpm crawl servicenow-incident --env uat` chạy headless ra exit 0.
- Mỗi bản ghi có `bankerPNumber` đúng định dạng.
- Chạy trên prod do người thực hiện, sau khi review `automations/tasks/servicenow-incident.ts`.

## Câu hỏi còn mở

1. pNumber lấy từ đâu: hồ sơ user của người log, hay nằm trong nội dung notes?
2. "Banker log incident" ứng với trường nào: Caller hay Opened by?
3. Notes gồm loại nào: Additional comments, Work notes, hay cả hai?
4. Có instance UAT cho agent dò không?
5. Có được dùng REST Table API của ServiceNow không? API này đọc bằng GET và ổn định hơn giao diện.
6. Ai sign-off Phase 0?
