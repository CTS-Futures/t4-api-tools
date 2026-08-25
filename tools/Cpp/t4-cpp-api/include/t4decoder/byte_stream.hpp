// Port of com.t4login.connection ByteReader + CountingInputStream
// (JS: src/connection/ByteReader.js, CountingInputStream.js).
//
// In-memory binary reader over a byte buffer plus a counting wrapper used by
// the chart readers to detect and skip unread trailing bytes within a
// length-prefixed record.
#pragma once

#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace t4 {

// Duck-typed stream interface (matches the `readByte()` contract the JS/Python
// codecs rely on). Reads past the end throw, mirroring the reference EOFError.
class InputStream {
public:
  virtual ~InputStream() = default;
  // Read exactly one byte; throws std::out_of_range at EOF.
  virtual std::uint8_t readByte() = 0;
  // Read exactly n bytes; throws std::out_of_range on short read.
  virtual std::vector<std::uint8_t> readExact(std::size_t n) = 0;
  // Skip up to n bytes; returns the number actually skipped.
  virtual std::size_t skip(std::size_t n) = 0;
  // Bytes remaining from the current position to the end.
  virtual std::size_t available() const = 0;
};

// Reader over a contiguous, caller-owned byte buffer.
class ByteReader : public InputStream {
public:
  ByteReader(const std::uint8_t* data, std::size_t len) : data_(data), len_(len) {}
  explicit ByteReader(const std::vector<std::uint8_t>& v)
      : data_(v.data()), len_(v.size()) {}

  std::size_t length() const { return len_; }
  std::size_t position() const { return pos_; }
  std::size_t available() const override { return len_ - pos_; }

  std::uint8_t readByte() override {
    if (pos_ >= len_)
      throw std::out_of_range("Unexpected end of stream in readByte");
    return data_[pos_++];
  }

  std::vector<std::uint8_t> readExact(std::size_t n) override {
    if (pos_ + n > len_)
      throw std::out_of_range("Unexpected end of stream in readExact");
    std::vector<std::uint8_t> out(data_ + pos_, data_ + pos_ + n);
    pos_ += n;
    return out;
  }

  std::size_t skip(std::size_t n) override {
    std::size_t start = pos_;
    std::size_t end = (pos_ + n < len_) ? pos_ + n : len_;
    pos_ = end;
    return pos_ - start;
  }

private:
  const std::uint8_t* data_;
  std::size_t len_;
  std::size_t pos_ = 0;
};

// Wraps an InputStream and counts bytes read since the last resetCount().
class CountingInputStream : public InputStream {
public:
  explicit CountingInputStream(InputStream& inner) : inner_(inner) {}

  std::size_t getCount() const { return count_; }
  void resetCount() { count_ = 0; }

  std::uint8_t readByte() override {
    std::uint8_t b = inner_.readByte();
    count_ += 1;
    return b;
  }

  std::vector<std::uint8_t> readExact(std::size_t n) override {
    auto data = inner_.readExact(n);
    count_ += data.size();
    return data;
  }

  std::size_t skip(std::size_t n) override {
    std::size_t skipped = inner_.skip(n);
    count_ += skipped;
    return skipped;
  }

  std::size_t available() const override { return inner_.available(); }

private:
  InputStream& inner_;
  std::size_t count_ = 0;
};

}  // namespace t4
