import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App' // Verifique se não tem '../' aqui
import './index.css' // Se você não tiver esse arquivo, comente esta linha

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)