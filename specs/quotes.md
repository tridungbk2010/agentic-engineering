# Spec: quotes

Task mẫu tham chiếu trên quotes.toscrape.com, một site sandbox công khai dành cho việc tập crawl.

## Mục tiêu

Lấy toàn bộ câu trích dẫn kèm tác giả và tag, để thử đầu-cuối luồng crawl, validate và analyze.

## Site & môi trường

| Env | URL bắt đầu | Ghi chú |
|---|---|---|
| live | https://quotes.toscrape.com/ | Site công khai, không có UAT |

## Dữ liệu & phê duyệt

- Phân loại dữ liệu: công khai.
- Có PII không, gồm những gì: không. Tên tác giả là người của công chúng.
- Người phê duyệt: không cần, dữ liệu công khai.
- Ngày phê duyệt: 2026-10-07.
- Env được phép cho agent dò: live.

## Auth

- Cách đăng nhập: không cần. Mọi trang đều xem được khi chưa đăng nhập.
- Tín hiệu hết phiên: không áp dụng. Trang `/login` có ô `username`, khai báo cho đủ.
- App giữ token ở đâu: cookie `session` không có hạn, chỉ sống trong một phiên trình duyệt.

## Input

Không có tham số.

## Output schema

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| text | string | có | Câu trích dẫn, kèm dấu ngoặc kép cong |
| author | string | có | Tên tác giả |
| authorSlug | string | có | Slug dùng trong URL `/author/<slug>` |
| tags | string[] | có | Có thể rỗng |

- Số bản ghi tối thiểu (`minRecords`): 100.
- Trường khóa duy nhất (`uniqueKey`): `text`.

Mẫu với giá trị giả: `specs/quotes.sample.json`.

## Phân trang & rate limit

- Cách sang trang: API JSON `/api/quotes?page=N`, trường `has_next` cho biết còn trang sau. Trang `/scroll` của site dùng chính API này.
- Số trang tối đa (`maxPages`): 20 (thực tế có 10 trang).
- Delay tối thiểu giữa các request (`rate.minDelayMs`): 500.

## Origin

| Origin | Loại (app / IdP / telemetry) |
|---|---|
| https://quotes.toscrape.com | app |

## Allowlist request ngoài GET/HEAD/OPTIONS

Không có. Crawler chỉ đọc bằng GET.

## URL cấm

Chỉ có `/logout`, đã bị chặn sẵn.

## Tiêu chí xong

- `pnpm crawl quotes` chạy headless ra exit 0 với 100 bản ghi.
- `pnpm analyze quotes` ra báo cáo có tổng số câu, số tác giả, top tác giả và top tag.
