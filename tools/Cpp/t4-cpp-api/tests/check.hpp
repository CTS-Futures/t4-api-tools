// Tiny dependency-free test harness (no GoogleTest/Catch needed).
//
// Usage:
//   T4_TEST(my_case) { CHECK(x == 1); CHECK_EQ(a, b); }
// test_main.cpp calls t4test::run_all().
#pragma once

#include <cstdio>
#include <functional>
#include <string>
#include <vector>

namespace t4test {

struct TestCase {
  const char* name;
  std::function<void()> fn;
};

inline std::vector<TestCase>& registry() {
  static std::vector<TestCase> r;
  return r;
}
inline int& total_failures() {
  static int f = 0;
  return f;
}
inline int& case_failures() {
  static int f = 0;
  return f;
}

struct Registrar {
  Registrar(const char* n, std::function<void()> fn) {
    registry().push_back({n, std::move(fn)});
  }
};

inline void report_fail(const char* file, int line, const std::string& msg) {
  ++total_failures();
  ++case_failures();
  std::printf("    FAIL %s:%d  %s\n", file, line, msg.c_str());
}

inline int run_all() {
  int passed = 0;
  for (auto& tc : registry()) {
    case_failures() = 0;
    tc.fn();
    if (case_failures() == 0) {
      ++passed;
    } else {
      std::printf("  [x] %s\n", tc.name);
    }
  }
  std::printf("\n%d/%zu tests passed, %d assertion failure(s)\n", passed,
              registry().size(), total_failures());
  return total_failures() == 0 ? 0 : 1;
}

}  // namespace t4test

#define T4_TEST(name)                                                       \
  static void name();                                                       \
  static ::t4test::Registrar t4_reg_##name(#name, name);                    \
  static void name()

#define CHECK(cond)                                                         \
  do {                                                                      \
    if (!(cond))                                                            \
      ::t4test::report_fail(__FILE__, __LINE__, "CHECK failed: " #cond);    \
  } while (0)

#define CHECK_EQ(a, b)                                                      \
  do {                                                                      \
    if (!((a) == (b)))                                                      \
      ::t4test::report_fail(__FILE__, __LINE__,                             \
                            "CHECK_EQ failed: " #a " == " #b);              \
  } while (0)

#define CHECK_MSG(cond, msg)                                                \
  do {                                                                      \
    if (!(cond)) ::t4test::report_fail(__FILE__, __LINE__, (msg));          \
  } while (0)
