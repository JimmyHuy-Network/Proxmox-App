import { describe, expect, it } from 'vitest'
import {
  TERM_PING,
  decodeTermFrame,
  decodeTermFrameFromString,
  encodeTermData,
  encodeTermResize,
} from './term-protocol'

const encoder = new TextEncoder()

describe('encodeTermData', () => {
  it('dùng số byte UTF-8 chứ không dùng String.length', () => {
    // Đây là bài test quan trọng nhất trong file. "à" có String.length là 1
    // nhưng chiếm 2 byte UTF-8; dùng nhầm .length thì server đọc thiếu byte
    // và mọi ký tự sau đó lệch hết.
    expect(encodeTermData('à')).toBe('0:2:à')
    expect('à'.length).toBe(1)
  })

  it('xử lý đúng tiếng Việt có dấu', () => {
    const text = 'Xin chào'
    // 'à' 2 byte, 'o' 1 byte → "Xin ch" 6 + 2 + 1 = 9
    expect(encodeTermData(text)).toBe(`0:9:${text}`)
    expect(text.length).toBe(8)
  })

  it('xử lý đúng ký tự tổ hợp nhiều byte', () => {
    // 'ằ' ở dạng dựng sẵn là 3 byte UTF-8.
    expect(encodeTermData('ằ')).toBe('0:3:ằ')
  })

  it('xử lý đúng emoji ngoài mặt phẳng cơ bản', () => {
    // Emoji là surrogate pair: String.length 2, nhưng 4 byte UTF-8.
    expect('🚀'.length).toBe(2)
    expect(encodeTermData('🚀')).toBe('0:4:🚀')
  })

  it('giữ nguyên hành vi với ASCII thuần', () => {
    expect(encodeTermData('ls -la\r')).toBe('0:7:ls -la\r')
  })

  it('mã hoá được chuỗi rỗng', () => {
    expect(encodeTermData('')).toBe('0:0:')
  })
})

describe('encodeTermResize', () => {
  it('kết thúc bằng dấu hai chấm theo đúng giao thức', () => {
    expect(encodeTermResize(120, 40)).toBe('1:120:40:')
  })
})

describe('decodeTermFrame', () => {
  it('khứ hồi được dữ liệu nhiều byte', () => {
    for (const sample of ['Xin chào', 'ằ', '🚀 khởi động', 'ls -la', '']) {
      expect(decodeTermFrameFromString(encodeTermData(sample))).toEqual({
        type: 'data',
        data: sample,
      })
    }
  })

  it('cắt thân khung theo byte, không theo ký tự', () => {
    // Thân dài đúng 2 byte ("à"), phần đuôi "XYZ" phải bị bỏ qua.
    const raw = encoder.encode('0:2:àXYZ')
    expect(decodeTermFrame(raw)).toEqual({ type: 'data', data: 'à' })
  })

  it('giải mã khung đổi kích thước', () => {
    expect(decodeTermFrameFromString('1:120:40:')).toEqual({ type: 'resize', cols: 120, rows: 40 })
  })

  it('chấp nhận khung đổi kích thước thiếu dấu hai chấm cuối', () => {
    expect(decodeTermFrameFromString('1:80:24')).toEqual({ type: 'resize', cols: 80, rows: 24 })
  })

  it('giải mã khung giữ nhịp', () => {
    expect(decodeTermFrameFromString(TERM_PING)).toEqual({ type: 'ping' })
  })

  it('trả null khi khung bị cắt giữa chừng thay vì giải mã nửa ký tự', () => {
    // Khai báo 5 byte nhưng chỉ có 2 — phải chờ thêm dữ liệu.
    expect(decodeTermFrameFromString('0:5:à')).toBeNull()
  })

  it('trả null với khung dị dạng', () => {
    expect(decodeTermFrame(new Uint8Array(0))).toBeNull()
    expect(decodeTermFrameFromString('không-phải-khung')).toBeNull()
    expect(decodeTermFrameFromString('0:abc:xyz')).toBeNull()
    expect(decodeTermFrameFromString('9:1:x')).toBeNull()
    expect(decodeTermFrameFromString('0')).toBeNull()
  })

  it('không nhầm chuỗi bắt đầu bằng 2 với khung giữ nhịp', () => {
    // '2' chỉ là ping khi đứng một mình đúng một byte.
    expect(decodeTermFrameFromString('2:5:hello')).toBeNull()
  })
})
