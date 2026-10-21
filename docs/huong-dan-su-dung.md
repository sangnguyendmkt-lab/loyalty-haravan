# Hướng dẫn sử dụng — Loyalty Haravan

File: **Loyalty Haravan** trên Google Drive. Mọi thao tác nằm trong menu **🎯 Loyalty**.

## Mỗi tuần (khoảng 10 phút)

1. **Xuất file khách hàng mới nhất từ Haravan**
   - Vào Haravan → Khách hàng → Xuất file. Mở file đó, chọn tất cả (Ctrl + A), sao chép (Ctrl + C).
   - Trong file Loyalty Haravan, mở sheet **Khách hàng Haravan**, bấm ô **A1**, dán (Ctrl + V). Phải dán **cả dòng tiêu đề**.
   - Dùng dán (Ctrl + V), không dùng *Tệp → Nhập*, vì hệ thống ghi nhận thời điểm dán.
2. Bấm **🎯 Loyalty → 🚀 Tạo file loyalty**.
   - Hệ thống tự tải đơn hàng mới từ Haravan, đối chiếu với câu trả lời Google Form và tính điểm.
   - Kết quả nằm ở sheet **Đợt hiện tại**: phần tóm tắt ở trên, danh sách khách từ dòng 9.
3. Xem sheet **Cần kiểm tra** (mục dưới đây). Nếu cần, ghi chú vào cột **Ghi chú**.
4. Bấm **📥 Tải file Excel**, rồi bấm link để tải file `loyalty_yyyy-MM-dd.xlsx`.
5. **Upload ngay** file đó lên Haravan (Khách hàng → Nhập file).
6. Bấm **✅ Xác nhận đã upload**:
   - Haravan nhận hết → chọn **Thành công toàn bộ**.
   - Haravan báo lỗi một số dòng → chọn **Thành công một phần** và dán **số điện thoại các dòng lỗi** (mỗi dòng một số). Những khách này sẽ được xét lại ở tuần sau.

**Không upload được, hoặc tạo đợt nhầm?** Bấm **❌ Huỷ đợt**. Chỉ huỷ khi file **chưa** được upload.

## Ý nghĩa sheet "Cần kiểm tra"

| Loại | Lý do | Cần làm gì |
|---|---|---|
| Cần xem | Đơn đã được người khác tích | Mã đơn đã cộng điểm cho số điện thoại khác. Kiểm tra nếu khách khiếu nại |
| Cần xem | SĐT sai | Khách điền sai số. Liên hệ khách nếu cần |
| Cần xem | Không tìm thấy | Mã đơn không có trên Haravan: khai sai, đơn giả, hoặc đơn trước 08/2025 |
| Cần xem | Đơn đã huỷ / hoàn / trả hàng | Không được tích điểm |
| Cần xem | Hạng không xác định | Hạng của khách trên Haravan không phải Silver/Gold/Platinum. Báo chủ shop |
| Đang chờ | Chờ giao | Đơn chưa giao xong. Tự xét lại tuần sau |
| Đang chờ | Chờ đủ 15 ngày | Đơn giao chưa đủ 15 ngày. Tự xét lại tuần sau |

Mọi đơn trong sheet này **tự được xét lại ở lần 🚀 sau**, không cần làm gì thêm.

## Thông báo thường gặp

- **"Đợt trước chưa được xác nhận hoặc huỷ"**: bấm ✅ (nếu đã upload) hoặc ❌ (nếu chưa).
- **"Dữ liệu khách hàng chưa được cập nhật hôm nay"**: làm lại bước 1.
- **"Đợt đã hết hạn"**: đợt chỉ dùng trong ngày tạo. Bấm ❌ Huỷ đợt rồi 🚀 tạo lại.
- **"Đang tải đơn hàng…"**: lần đầu hệ thống phải tải nhiều đơn và tự tải tiếp mỗi 5 phút. Bấm 🚀 lại sau.
- **"Đang có người xử lý"**: người khác đang bấm nút. Chờ một chút rồi thử lại.

## Chỉ dành cho chủ shop (menu Quản trị)

- **Cài đặt** (số tiền mỗi điểm, hệ số hạng, số ngày chờ): sửa trực tiếp trong sheet **Cài đặt**.
- **⚙️ Cài đặt kết nối Haravan**: dán token mới khi đổi token.
- **🔒 Bật phân quyền**: chạy một lần sau khi chia sẻ file cho nhân viên.
- **📊 Cập nhật báo cáo**: báo cáo tự cập nhật sau mỗi lần ✅. Nút này dùng khi cần cập nhật tay.
