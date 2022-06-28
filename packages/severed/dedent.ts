const reLeadingNewline = /^[ \t]*(?:\r\n|\r|\n)/;
const reTrailingNewline = /(?:\r\n|\r|\n)[ \t]*$/;
const reDetectIndentation = /(?:\r\n|\r|\n)([ \t]*)(?:[^ \t\r\n]|$)/;

function _dedentArray(strings: ReadonlyArray<string>) {
  // If first interpolated value is a reference to outdent,
  // determine indentation level from the indentation of the interpolated value.
  let indentationLevel = 0;

  const match = strings[0].match(reDetectIndentation);
  if (match) {
    indentationLevel = match[1].length;
  }

  const reSource = `(\\r\\n|\\r|\\n).{0,${indentationLevel}}`;
  const reMatchIndent = new RegExp(reSource, 'g');

  const l = strings.length;
  const dedentedStrings = strings.map((v, i) => {
    // Remove leading indentation from all lines
    v = v.replace(reMatchIndent, '$1');
    // Trim a leading newline from the first string
    if (i === 0) {
      v = v.replace(reLeadingNewline, '');
    }
    // Trim a trailing newline from the last string
    if (i === l - 1) {
      v = v.replace(reTrailingNewline, '');
    }
    return v;
  });
  return dedentedStrings;
}

function concatStringsAndValues(
  strings: ReadonlyArray<string>,
  values: ReadonlyArray<any>,
): string {
  let ret = '';
  for (let i = 0, l = strings.length; i < l; i++) {
    ret += strings[i];
    if (i < l - 1) {
      ret += values[i];
    }
  }
  return ret;
}

const dedent: Dedent = (stringsOrOptions, ...values) => {
  const strings = stringsOrOptions;

  const renderedArray = _dedentArray(strings);

  if (values.length === 0) return renderedArray[0];

  return concatStringsAndValues(renderedArray, values);
};

export interface Dedent {
  (strings: TemplateStringsArray, ...values: Array<any>): string;
}

export { dedent };
