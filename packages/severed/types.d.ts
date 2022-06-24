declare module 'magic-string' {
  import * as mString from 'magic-string-original-types';
  export * from 'magic-string-original-types';
  export default mString.default.default;
}

declare module 'require-from-string' {
  export default function requireFromString(
    code: string,
    filename?: string,
  ): any;
}
