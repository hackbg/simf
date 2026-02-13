export function __assert_fail (...args: unknown[]) {
  throw new Error(['__assert_fail:', ...args].join(' '))
}
