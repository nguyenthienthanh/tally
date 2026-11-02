# Credit và chi phí

Trong tally có hai con số nằm cạnh nhau, và chúng không cùng một tư cách.

- **USD** tính từ bảng giá đã công bố. Nó chính xác.
- **Credit của gói** tính từ một công thức mà Anthropic không công bố. Nó được khớp với chính phần
  trăm đang báo về trên máy bạn, và nó luôn đi kèm sai số.

Trang này giải thích cả hai, và bốn cách phía credit từ chối giả vờ.

---

## USD: chính xác

Giá theo triệu token lấy từ skill `claude-api` của Claude Code, ghim trong `src/data/pricing.ts`
kèm ngày đọc. Hệ số cache:

| Thành phần | Hệ số trên giá input |
| --- | --- |
| Ghi cache 5 phút | 1,25x |
| Ghi cache 1 giờ | 2x |
| Đọc cache | 0,1x, có ngoại lệ theo model |

Con số tính ra đã được đối chiếu với `total_cost_usd` mà `claude -p --output-format json` báo về, và
khớp tới chữ số thập phân thứ chín (`$0.356643` so với `$0.356643`).

Model không có trong bảng thì đóng góp `$0` **và nói rõ điều đó**, chứ không bị lặng lẽ gán giá của
model hàng xóm.

---

## Credit của gói: khớp ra, và có dán nhãn

### Hằng số lấy từ đâu

Claude Code lưu bảng credit của chính nó trong `~/.claude.json`, dưới
`cachedGrowthBookFeatures.tengu_amber_tally`:

```
credits = tokens / 1e6 × creditsPerMillionTokens[model]
fiveHourCredits = { default_claude_max_5x: 50000, default_claude_max_20x: 200000 }
```

tally đọc bảng đó trực tiếp. Có một bản fallback đi kèm cho máy không có khoá này, và `doctor` cho
bạn biết đang dùng bản nào. **Model không có trong bảng thì vẫn không có**: nó hiện `n/a`, không bao
giờ `0`.

### Cái được khớp là gì

Câu còn bỏ ngỏ là *token nào được tính*. tally thử năm giả thuyết và chọn cái tái tạo sát nhất
`five_hour_pct` mà client của bạn báo về:

| Giả thuyết | Token được tính |
| --- | --- |
| `in_out` | input + output |
| `out_only` | output |
| `in_out_write` | input + output + ghi cache |
| `in_out_write_read25` | input + output + ghi cache + 0,025 × đọc cache |
| `all` | tất cả, đọc cache tính đủ |

Mặc định là `in_out_write_read25`. Trọng số 0,025 không phải trang trí: trên cửa sổ dùng để suy ra
nó, tính đủ phần đọc cache vọt lên gấp hàng trăm lần, còn trọng số tái tạo đúng phần trăm báo về là
0,0269. 1/40 là con số tròn nằm ngay cạnh, và nó chỉ được áp ở chỗ phép khớp nói là thuộc về.

`all` cố ý không bao giờ là mặc định. Nó thổi credit lên hàng trăm lần.

### Bốn lần từ chối

`calibrate()` trả về một trạng thái, và trang in nó ngay cạnh con số:

| Trạng thái | Nghĩa |
| --- | --- |
| `calibrated` | Một giả thuyết tái tạo được phần trăm báo về trong vòng 15%. Sai số được hiện ra. |
| `poor_fit` | Giả thuyết tốt nhất vẫn lệch hơn 15%. Các con số bị dán nhãn chỉ để tham khảo. |
| `low_signal` | Mới dùng chưa tới 5% trần. Quá ít tín hiệu để khớp. |
| `stale_index` | Index cũ hơn mốc chụp hạn mức quá năm phút, nên so sánh sẽ đếm thiếu có hệ thống. Nó bảo bạn index lại thay vì hiện một con số sai. |
| `no_ceiling` | Không đọc được trần gói. Không thử hiệu chuẩn. |
| `no_data` | Không có sự kiện nào trong cửa sổ hiệu chuẩn. |

Còn một nhãn thứ năm không phải trạng thái. Một cửa sổ 5 giờ nặng hơn hẳn cửa sổ dùng để khớp thì bị
đánh dấu **ngoại suy**, vì một phép khớp làm trên cửa sổ nhẹ nói được rất ít về một cửa sổ nặng.

### Độ chính xác đo được

Trên máy đã dựng ra nó, giả thuyết được chọn lệch **3 đến 9%** so với phần trăm báo về, trên các cửa
sổ đã thử. Đó là khoảng thật thà, không phải lời bảo đảm cho tài khoản của bạn.

---

## Các phát hiện, và ba loại thiệt hại

Có năm phát hiện, mỗi cái đều quy ra tiền. Chi tiết quan trọng là con số của chúng không cùng một
nghĩa, nên mỗi cái mang một `damage_kind` và trang dùng một động từ khác nhau cho từng loại:

| Loại | Động từ dùng | Ví dụ |
| --- | --- | --- |
| `saving` | "có thể tiết kiệm" | ghi cache 1 giờ lẽ ra để 5 phút |
| `spend` | "đã tiêu" | những phiên nặng subagent tốn bao nhiêu |
| `peak` | "đỉnh đo được" | cửa sổ 5 giờ nặng nhất so với trần |

Phân biệt này tồn tại vì một bản trước từng báo một đỉnh đo được kèm chữ "thiệt hại", khiến nó đọc ra
thành tiền đã mất. Một con số đi kèm sai động từ là một lời nói dối có giá trị đúng.

Năm phát hiện:

1. **Ghi cache 1 giờ** đắt gấp 2 lần ghi 5 phút và cần ba lần đọc mới hoà.
2. **Cache trượt**: phần đọc mà bạn đã trả tiền để dựng lại.
3. **Phiên nặng subagent** chạy trên model đắt.
4. **Model quá cỡ** trả lời những lượt ngắn không gọi tool nào.
5. **Rủi ro chạm trần**: bao nhiêu lần một cửa sổ 5 giờ trôi vượt 80% trần gói của bạn.
