/**
 * Loyalty Haravan — menu and simple triggers (Apps Script).
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🎯 Loyalty')
    .addItem('🚀 Tạo file loyalty', 'createBatch')
    .addItem('📥 Tải file Excel', 'exportBatch')
    .addItem('✅ Xác nhận đã upload', 'confirmBatch')
    .addItem('❌ Huỷ đợt', 'cancelBatch')
    .addSeparator()
    .addItem('📊 Cập nhật báo cáo', 'refreshReport')
    .addSubMenu(SpreadsheetApp.getUi().createMenu('Quản trị (chủ shop)')
      .addItem('⚙️ Cài đặt kết nối Haravan', 'setupToken')
      .addItem('🛠 Thiết lập file', 'setupSheets')
      .addItem('📦 Chép dữ liệu cũ (1 lần)', 'migrateLedgerFromOldFile')
      .addItem('🔍 Chạy thử API', 'probeHaravan')
      .addItem('🔄 Tải đơn hàng Haravan', 'startOrderSync')
      .addItem('🔒 Bật phân quyền', 'protectSheets'))
    .addToUi();
}

/** Simple trigger: remember when the customer export was pasted, so a stale export can't be used. */
function onEdit(e) {
  if (e && e.range && e.range.getSheet().getName() === SHEETS.CUSTOMERS) {
    PropertiesService.getScriptProperties().setProperty(CUSTOMERS_UPDATED_KEY, new Date().toISOString());
  }
}
