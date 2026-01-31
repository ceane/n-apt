// Main entry point migrated from JavaScript to ReScript
// Renders the App component into the DOM

// ReactDOM bindings
module ReactDOM = {
  module Client = {
    type root

    @module("react-dom/client")
    external createRoot: Dom.element => root = "createRoot"

    @send
    external render: (root, React.element) => unit = "render"
  }
}

// Document bindings
@scope("document")
external getElementById: string => Js.Nullable.t<Dom.element> = "getElementById"

// Import CSS
@module external _css: string = "./index.css"

// App component binding
module App = {
  @module("./App.res.mjs") @react.component
  external make: unit => React.element = "make"
}

// Initialize the app
switch getElementById("root")->Js.Nullable.toOption {
| Some(rootElement) =>
  let root = ReactDOM.Client.createRoot(rootElement)
  ReactDOM.Client.render(
    root,
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
| None => Js.Console.error("Could not find root element")
}
