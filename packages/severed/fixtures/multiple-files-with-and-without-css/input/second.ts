import { getPurple } from './colors';

export const foo = (el: Element) => {
  el.classList.add(css`
    color: ${getPurple()};
  `);
};
