// [학습] 화면 시작점. index.html이 이 파일 하나만 불러오고, Vite가 여기서부터 import를 따라가 전체를 묶습니다.
// [학습]   CSS도 import로 가져오면 Vite가 빌드 때 함께 묶어 줍니다(예전: index.html의 <link>).
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles/main.css';

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
