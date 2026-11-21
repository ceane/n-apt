import React from "react";
import { Navigate } from "react-router";

export default function FilePlaybackRoute() {
  return <Navigate to="/visualizer?source=fileSelection" replace />;
}
