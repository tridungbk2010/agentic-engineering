# Spec: efis-my-learning

**Site:** https://staging.efis.edu.vn/my-learning (env `staging`)

**Mục đích:** lấy danh sách khóa học đã đăng ký của học viên đang đăng nhập và tiến độ từng khóa.

## Thuộc tính cần lấy (mỗi khóa học)

- Tên khóa học
- Link khóa học
- % tiến độ
- Số bài đã hoàn thành / tổng số bài

## Tham số

Không có.

## Dữ liệu

- Loại: test
- PII: có (tên, email học viên, tiến độ học)
- Người duyệt: chris, 2026-10-07
- Agent được dò trên: staging

## Đăng nhập

Google OAuth hoặc email + OTP. Đăng nhập tay bằng `pnpm signin efis-my-learning`.

## Ghi chú

- `/my-learning` không liệt kê khóa học, nên lấy danh sách từ `/courses` (mục "Khóa học của bạn") và tiến độ từ `/learn/<slug>`.
- Cần xác nhận: dashboard báo 4 khóa nhưng `/courses` chỉ hiện 1.
