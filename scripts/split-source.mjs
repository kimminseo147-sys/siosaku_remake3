import fs from 'node:fs';
import path from 'node:path';

// 보관한 원본에서 코드를 그대로 추출한다. 기능 개선은 이 단계에 포함하지 않는다.
const source = fs.readFileSync('reference/original.html', 'utf8');
const lines = source.split(/\r?\n/);
const block = (start, end) => lines.slice(start - 1, end).map(line => line.startsWith('    ') ? line.slice(4) : line).join('\n');
const write = (name, body) => {
  fs.mkdirSync(path.dirname(name), { recursive: true });
  fs.writeFileSync(name, body + '\n', 'utf8');
};
const module = (name, imports, body, exports) => write(name, `${imports}\n\n${body}\n\nexport { ${exports} };`);

write('frontend/styles/main.css', block(8, 29));
module('frontend/config/supabase.js', '', block(42, 45), 'db');
module('frontend/config/catalog.js', '', block(46, 59), 'BRANCHES, ALL, DEFAULT_PRODUCTS, COMMON_ALIASES, GANGDONG_ALIASES, GANGDONG_MIN_DATE');
module('frontend/domain/products.js', "import { COMMON_ALIASES, GANGDONG_ALIASES } from '../config/catalog.js';", block(61, 82), 'cleanName, keyName, normalizeProduct');
module('frontend/domain/dates.js', '', block(83, 89), 'isValidDay, localDay, dayIndex, weekend');
module('frontend/domain/quantity.js', '', block(90, 106), 'fmt, validQty, parseQty, optionalQty');
module('frontend/domain/inventory.js', "import { validQty } from './quantity.js';\nimport { normalizeProduct } from './products.js';", block(107, 135) + '\n\n' + block(180, 200), 'stockStatus, observedSales, canonicalRecord, safeLegacy, updateReport');
module('frontend/parsers/kakao.js', "import { isValidDay } from '../domain/dates.js';\nimport { normalizeProduct } from '../domain/products.js';\nimport { parseQty } from '../domain/quantity.js';", block(136, 179), 'parseReportDate, parseKakao');
module('frontend/parsers/excel.js', "import { GANGDONG_MIN_DATE } from '../config/catalog.js';\nimport { isValidDay, localDay } from '../domain/dates.js';\nimport { cleanName, normalizeProduct } from '../domain/products.js';\nimport { validQty, parseQty } from '../domain/quantity.js';", block(201, 263) + '\n\n' + block(358, 366), 'excelDate, excelQty, analyzeExcelRows, readExcel');
module('frontend/domain/analytics.js', "import { weekend } from './dates.js';\nimport { canonicalRecord, stockStatus, observedSales } from './inventory.js';", block(264, 288), 'summarize');
module('frontend/domain/forecasting.js', "import { dayIndex, weekend } from './dates.js';\nimport { canonicalRecord, observedSales } from './inventory.js';", block(289, 305), 'predict');

const bulk = `async function insertRecordsInBatches(toInsert){\n${block(467, 471)}\n}`;
module('frontend/services/inventoryRepository.js', "import { db } from '../config/supabase.js';\nimport { BRANCHES } from '../config/catalog.js';\nimport { isValidDay } from '../domain/dates.js';", block(308, 357) + '\n\n' + bulk, 'loadRecords, loadProducts, addProducts, saveRecord, removeRecord, insertRecordsInBatches');

const appImports = `import { BRANCHES, ALL, DEFAULT_PRODUCTS } from './config/catalog.js';
import { normalizeProduct } from './domain/products.js';
import { isValidDay, localDay } from './domain/dates.js';
import { fmt, optionalQty } from './domain/quantity.js';
import { canonicalRecord, safeLegacy, updateReport } from './domain/inventory.js';
import { summarize } from './domain/analytics.js';
import { predict } from './domain/forecasting.js';
import { parseKakao } from './parsers/kakao.js';
import { readExcel } from './parsers/excel.js';
import { loadRecords, loadProducts, addProducts, saveRecord, removeRecord, insertRecordsInBatches } from './services/inventoryRepository.js';

const { useState, useMemo, useEffect } = React;`;
const originalLoop = block(467, 471);
const app = block(368, 611).replace(originalLoop, '        await insertRecordsInBatches(toInsert);');
if (app.includes('db.from(') || !app.endsWith('}')) throw new Error('App 추출 범위를 확인하세요.');
// Babel standalone는 변환 결과를 HTML에 넣으므로 이 진입 파일의 import는 index.html 기준이다.
write('frontend/App.jsx', `// Babel standalone 진입 파일: import 경로는 index.html을 기준으로 합니다.\n${appImports.replaceAll("from './", "from './frontend/")}\n\n${app}\n\n${block(612, 612)}`);
write('index.html', lines.slice(0, 6).join('\n') + '\n  <link rel="stylesheet" href="./frontend/styles/main.css">\n</head>\n<body>\n  <div id="root"></div>\n' + lines.slice(34, 39).join('\n') + '\n  <!-- Babel은 기존 방식대로 JSX만 변환하며, import/export로 파일을 연결합니다. -->\n  <script type="text/babel" data-type="module" src="./frontend/App.jsx"></script>\n</body>\n</html>');
