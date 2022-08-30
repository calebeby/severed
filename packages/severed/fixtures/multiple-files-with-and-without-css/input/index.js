import { foo } from './second';
import * as colors from './colors';

const className = css`
  background: ${colors.green};
`;

el.classList.add(className);

foo(el);
