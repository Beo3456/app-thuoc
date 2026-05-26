# Nhắc Thuốc An Lành

Web app tĩnh để nhắc người lớn tuổi uống thuốc. App có thể chạy trên điện thoại, cài ra màn hình chính như PWA, lưu lịch và ảnh thuốc trong IndexedDB của trình duyệt.

## Tính năng

- Trang chính chỉ hiện các lần uống thuốc sắp tới.
- Màn hình riêng để thêm, sửa, bật/tắt và xóa lịch nhắc.
- Chuông báo khi đến giờ, không dùng giọng đọc.
- Mỗi lịch có thể dùng âm báo riêng từ file audio, tiếng trong video ngắn, hoặc bản thu âm trực tiếp.
- Chụp hoặc chọn ảnh thuốc để dễ nhận diện.
- Lưu dữ liệu bằng IndexedDB, đóng app rồi mở lại vẫn còn lịch.
- Xuất/nhập dữ liệu JSON để sao lưu.

## Public bằng Netlify

1. Vào https://app.netlify.com/drop
2. Kéo toàn bộ thư mục này hoặc file `nhac-thuoc-public.zip` vào trang Netlify.
3. Netlify sẽ tạo link HTTPS public.
4. Mở link trên điện thoại, bật thông báo, rồi chọn Add to Home Screen/Cài vào màn hình chính.

## Public bằng GitHub Pages

1. Tạo repository mới trên GitHub.
2. Upload toàn bộ file trong thư mục này.
3. Vào Settings > Pages.
4. Chọn Deploy from a branch, branch `main`, folder `/root`.
5. Mở link GitHub Pages trên điện thoại.

## Ghi chú về dữ liệu

- IndexedDB lưu dữ liệu trên từng thiết bị/trình duyệt. Nếu mở app trên điện thoại khác thì dữ liệu không tự đồng bộ.
- Muốn đồng bộ nhiều máy hoặc nhiều người dùng cần thêm cloud database như Firebase hoặc Supabase.
- Trình duyệt chỉ cho PWA/service worker và thông báo ổn định trên HTTPS hoặc localhost.
- Bản web nhắc tốt nhất khi app/PWA đang mở. Nếu cần nhắc chắc chắn cả khi app đã đóng hẳn, nên làm bản native bằng Capacitor và dùng local notifications.
