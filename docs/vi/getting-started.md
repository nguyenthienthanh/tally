# Bắt đầu

## Yêu cầu

- **Node 22.13 trở lên.** tally dùng `node:sqlite` dựng sẵn, nên không có native module nào phải
  biên dịch và không có database server nào phải cài. Bản 22.5 có module đó nhưng nằm sau cờ
  `--experimental-sqlite`; 22.13 là bản đầu tiên nó chạy thẳng, nên đó là sàn. CI chạy bộ test trên
  22.13, 24 và 26.
- **pnpm** (bản nào cũng được; CI dùng 11). npm cũng được.
- Một máy đã dùng Claude Code, tức là có thư mục `~/.claude/projects`.

## Cài

```bash
git clone https://github.com/nguyenthienthanh/tally.git
cd tally
pnpm install
pnpm build
```

Chưa có bản cài toàn cục và chưa `npm publish`. Chạy thẳng từ bản clone.

## 1. Kiểm nguồn dữ liệu

```bash
node dist/cli.js doctor
```

`doctor` in mỗi nguồn một dòng và đánh dấu có hay thiếu:

| Nguồn | tally lấy gì từ đó |
| --- | --- |
| `~/.claude/projects/**/*.jsonl` | metadata từng request và số token |
| `~/.claude.json` | hạng gói, và các hằng số credit của chính Claude Code |
| `~/.claude/cache/rate-limits.json` | phần trăm 5 giờ và 7 ngày hiện tại |
| `~/.claude/cache/usage-cycle.json` | chi phí tương đương API cho chu kỳ tính tiền |
| `~/.claude/usage-data/` | kết quả `/insights` của chính Claude Code |

Thiếu nguồn không phải lỗi chết. Trang hiện cái gì có và đánh dấu phần còn lại là không biết. Ví dụ
thiếu trần gói thì nó ẩn phần credit, chứ không bịa ra một con số.

## 2. Dựng index

```bash
node dist/cli.js index
```

Lần đầu đọc mọi transcript. Lần sau chỉ đọc phần byte ghi thêm kể từ lần trước, theo dấu byte
watermark của từng file, nên chạy hằng ngày chỉ tốn một phần nhỏ của một giây.

Đo trên máy đã dựng ra nó: 4,5 GB qua 3.473 file trong khoảng 13 giây, sinh ra file SQLite 55 MB tại
`~/.tally/index.sqlite`.

`--full` ép quét lại toàn bộ. Hiếm khi cần; trường hợp đáng kể là sau khi nâng cấp tally mà ghi chú
phát hành nói phiên bản derived facts đã đổi, và ngay cả khi đó bộ quét cũng tự nhận ra và tự quét
lại một lần.

## 3. Mở dashboard

```bash
node dist/cli.js serve          # http://127.0.0.1:7777
node dist/cli.js serve --watch  # quét lại khi có phiên mới
```

Server chỉ gắn vào `127.0.0.1`. Mọi thứ trừ hai route POST đều chỉ đọc, và hai route đó đòi một token
sinh mới mỗi lần khởi động server rồi nhúng vào trang.

### Chia sẻ ảnh màn hình

```bash
node dist/cli.js serve --redact
```

`--redact` thay đường dẫn dự án bằng hash có muối trước khi tới trang, nên bạn khoe được con số mà
không lộ mình đang làm gì.

## 4. Hoặc ở lại terminal

```bash
node dist/cli.js report --grain=day --tz=Asia/Ho_Chi_Minh
```

Cùng những con số đó, không cần trình duyệt: gói và trần, trạng thái hiệu chuẩn, credit và USD theo
model, bảng gộp theo mức bạn chọn, và các phát hiện kèm số tiền.

## Một ghi chú về ngôn ngữ

Dashboard có tiếng Việt, tiếng Trung và tiếng Anh, tự nhận theo trình duyệt và đổi được bằng nút cờ.
CLI in tiếng Anh. Tài liệu có đủ ba thứ tiếng; xem các liên kết ở đầu README.

## Gỡ rối

**`No such built-in module: node:sqlite`.** Node của bạn cũ hơn 22.13. Kiểm bằng `node -v`.

**Dashboard báo index đã cũ.** Mốc chụp hạn mức mới hơn lần quét cuối, nên so sánh sẽ đếm thiếu.
Chạy `node dist/cli.js index`.

**Một model hiện credit là `n/a`.** Model đó không có mức credit công bố trong `~/.claude.json` của
bạn. tally hiện cái không biết là `n/a`, không bao giờ là `0`.

**Không có gì được index.** Kiểm xem `~/.claude/projects` có tồn tại và có file `.jsonl` không.
`doctor` in số file và tổng dung lượng nó thấy.
