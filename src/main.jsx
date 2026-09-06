import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { LojaProvider } from "./lib/LojaContext.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <LojaProvider>
      <App />
    </LojaProvider>
  </StrictMode>
);
