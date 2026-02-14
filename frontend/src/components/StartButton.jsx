import { useState } from "react";

export default function App() {
  const [isActive, setIsActive] = useState(false);

  const toggleInterview = () => {
    setIsActive(!isActive);
  };

  return (
    <div style={{ textAlign: "center", marginTop: "100px" }}>
      <h1>Voice Form Interview</h1>

      <button
        onClick={toggleInterview}
        style={{
          padding: "15px 30px",
          fontSize: "18px",
          backgroundColor: isActive ? "red" : "green",
          color: "white",
          border: "none",
          borderRadius: "8px",
          cursor: "pointer"
        }}
      >
        {isActive ? "Stop Interview" : "Start Interview 🎤"}
      </button>
    </div>
  );
}
