# Chuyển Sổ đơn đã tích từ file cũ

- File mới "Loyalty Haravan": `1eyrrzO-lgX9Jk-YlofIgAq0wSHcyJoC3QwhgzohFE5s`
- File cũ (chỉ đọc): `1yICSQ4bGpCQxMIJ_98PlD8ka6IRT-bt3xt6toQNGN_8`, sheet `Edit`, dòng 3 trở đi, cột A–Q
- Cách chạy: menu 🎯 Loyalty → "Chép dữ liệu cũ (1 lần)" → hàm `migrateLedgerFromOldFile()`
- Quy tắc: chỉ dòng `Trạng Thái = Done`, mỗi mã đơn lấy lần đầu, `08/01/2025` → `08/01/2026`
- Kiểm tra trước trên dữ liệu thật (20/10/2026): **4.952 mã đơn, tổng 47.028 điểm**
- 11 dòng có SĐT không hợp lệ trong file cũ được giữ nguyên chuỗi gốc
