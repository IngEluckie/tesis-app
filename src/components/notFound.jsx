// notFound.js

import React from "react";
import { Link } from "react-router";

export const NotFound = () => {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        color: "#333",
        backgroundColor: "#f9f9f9",
        textAlign: "center",
        padding: "1rem",
      }}
    >
      <h1 style={{ fontSize: "5rem", margin: 0 }}>404</h1>
      <h2 style={{ marginTop: "0.5rem" }}>Page not found</h2>
      <p style={{ marginTop: "0.5rem", maxWidth: "400px" }}>
        La página que buscas no existe, o ha sido removida.
      </p>
      <Link
        to="/"
        style={{
          marginTop: "1.5rem",
          padding: "0.75rem 1.5rem",
          borderRadius: "8px",
          textDecoration: "none",
          color: "#fff",
          backgroundColor: "#0066cc",
          transition: "background 0.2s ease-in-out",
        }}
        onMouseOver={(e) => (e.target.style.backgroundColor = "#004999")}
        onMouseOut={(e) => (e.target.style.backgroundColor = "#0066cc")}
      >
        Go back home
      </Link>
    </div>
  );
};
