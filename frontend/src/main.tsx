import React from 'react';
import ReactDOM from 'react-dom/client';
import Root from './Root';
import './styles.css';
// A different signing link in the same tab only changes the fragment, which does not reload the page.
window.addEventListener('hashchange', () => window.location.reload());
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Root path={window.location.pathname} hash={window.location.hash} /></React.StrictMode>);
