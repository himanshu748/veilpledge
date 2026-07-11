type AssertionMessage = string | Error | undefined;

export class AssertionError extends Error {
  readonly code = "ERR_ASSERTION";
  readonly actual: unknown;
  readonly expected: unknown;
  readonly operator: string;

  constructor(options: {
    message?: AssertionMessage;
    actual?: unknown;
    expected?: unknown;
    operator?: string;
  } = {}) {
    const message =
      options.message instanceof Error
        ? options.message.message
        : options.message ?? `Assertion failed${options.operator ? `: ${options.operator}` : ""}`;
    super(message);
    this.name = "AssertionError";
    this.actual = options.actual;
    this.expected = options.expected;
    this.operator = options.operator ?? "assert";
  }
}

const throwAssertion = (
  actual: unknown,
  expected: unknown,
  operator: string,
  message?: AssertionMessage,
): never => {
  if (message instanceof Error) throw message;
  throw new AssertionError({ actual, expected, operator, message });
};

function assert(value: unknown, message?: AssertionMessage): asserts value {
  if (!value) throwAssertion(value, true, "==", message);
}

export const ok = assert;

export const fail = (message?: AssertionMessage): never =>
  throwAssertion(undefined, undefined, "fail", message);

export const equal = (
  actual: unknown,
  expected: unknown,
  message?: AssertionMessage,
): void => {
  // Node's legacy assert.equal deliberately uses coercive comparison.
  if (actual != expected) throwAssertion(actual, expected, "==", message);
};

export const notEqual = (
  actual: unknown,
  expected: unknown,
  message?: AssertionMessage,
): void => {
  if (actual == expected) throwAssertion(actual, expected, "!=", message);
};

export const strictEqual = (
  actual: unknown,
  expected: unknown,
  message?: AssertionMessage,
): void => {
  if (!Object.is(actual, expected)) throwAssertion(actual, expected, "strictEqual", message);
};

export const notStrictEqual = (
  actual: unknown,
  expected: unknown,
  message?: AssertionMessage,
): void => {
  if (Object.is(actual, expected)) throwAssertion(actual, expected, "notStrictEqual", message);
};

const deepMatch = (actual: unknown, expected: unknown, seen = new WeakMap<object, object>()): boolean => {
  if (Object.is(actual, expected)) return true;
  if (
    !actual ||
    !expected ||
    typeof actual !== "object" ||
    typeof expected !== "object" ||
    Object.getPrototypeOf(actual) !== Object.getPrototypeOf(expected)
  ) {
    return false;
  }
  if (seen.get(actual) === expected) return true;
  seen.set(actual, expected);

  if (actual instanceof Uint8Array && expected instanceof Uint8Array) {
    return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
  }
  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();
  }

  const actualKeys = Reflect.ownKeys(actual);
  const expectedKeys = Reflect.ownKeys(expected);
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every(
      (key) =>
        expectedKeys.includes(key) &&
        deepMatch(
          (actual as Record<PropertyKey, unknown>)[key],
          (expected as Record<PropertyKey, unknown>)[key],
          seen,
        ),
    )
  );
};

export const deepStrictEqual = (
  actual: unknown,
  expected: unknown,
  message?: AssertionMessage,
): void => {
  if (!deepMatch(actual, expected)) {
    throwAssertion(actual, expected, "deepStrictEqual", message);
  }
};

export const deepEqual = deepStrictEqual;

export const notDeepStrictEqual = (
  actual: unknown,
  expected: unknown,
  message?: AssertionMessage,
): void => {
  if (deepMatch(actual, expected)) {
    throwAssertion(actual, expected, "notDeepStrictEqual", message);
  }
};

export const notDeepEqual = notDeepStrictEqual;

Object.assign(assert, {
  AssertionError,
  ok,
  fail,
  equal,
  notEqual,
  strictEqual,
  notStrictEqual,
  deepEqual,
  deepStrictEqual,
  notDeepEqual,
  notDeepStrictEqual,
  strict: assert,
});

export const strict = assert;
export default assert;
