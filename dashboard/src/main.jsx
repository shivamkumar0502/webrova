import React from 'react';
import ReactDOM from 'react-dom/client';
import FreeApp from './free/FreeApp';
import LegacyApp from './free/LegacyApp';
const App = location.pathname === '/byok' ? LegacyApp : FreeApp;
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
