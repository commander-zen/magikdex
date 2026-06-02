import { useState } from "react";
import { C } from "./constants";
import GlassNav from "./components/GlassNav";
import HomeScreen from "./screens/HomeScreen";
import CollectionScreen from "./screens/CollectionScreen";
import BrewScreen from "./screens/BrewScreen";
import PlayScreen from "./screens/PlayScreen";
import AnalyzeScreen from "./screens/AnalyzeScreen";

export default function App() {
  const [activeTab, setActiveTab] = useState("analyze");

  const navHeight = 90;

  const renderScreen = () => {
    if (activeTab === "home")       return <HomeScreen />;
    if (activeTab === "collection") return <CollectionScreen />;
    if (activeTab === "brew")       return <BrewScreen />;
    if (activeTab === "play")       return <PlayScreen />;
    if (activeTab === "analyze")    return <AnalyzeScreen />;
    return null;
  };

  return (
    <div style={{
      height: "100dvh",
      width: "100%",
      display: "flex",
      flexDirection: "column",
      background: C.base,
      overflow: "hidden",
      position: "relative",
    }}>
      <div style={{
        flex: 1,
        overflow: "hidden",
        paddingBottom: navHeight,
      }}>
        {renderScreen()}
      </div>

      <GlassNav active={activeTab} onSelect={setActiveTab} />
    </div>
  );
}
