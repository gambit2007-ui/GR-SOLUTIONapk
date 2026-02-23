alert("O arquivo main foi carregado!");
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App' 

// Removi o import do CSS para garantir que nada trave
const rootElement = document.getElementById('root');

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
} else {
  console.error("Não foi possível encontrar o elemento root no HTML");
}