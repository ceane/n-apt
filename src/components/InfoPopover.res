// InfoPopover component migrated from JavaScript to ReScript
// A tooltip component that shows an info icon with a popover on hover

// Props type for the component (not used directly since we use labeled arguments)
type infoPopoverProps = {
  title?: string,
  content: string,
}

// ReactDOM.createPortal binding
@module("react-dom")
external createPortal: (React.element, Dom.element) => React.element = "createPortal"

// DOM bindings
@send
external getBoundingClientRect: Dom.element => {
  "top": float,
  "right": float,
  "height": float,
} = "getBoundingClientRect"

@scope("document")
external body: Dom.element = "body"

@react.component
let make = (~title: string="Information", ~content: string) => {
  let (isVisible, setIsVisible) = React.useState(() => false)
  let (position, setPosition) = React.useState(() => {"x": 0.0, "y": 0.0})
  let iconRef = React.useRef(Js.Nullable.null)

  let handleMouseEnter = () => {
    switch iconRef.current->Js.Nullable.toOption {
    | Some(el) =>
      let rect = el->getBoundingClientRect
      setPosition(_ => {"x": rect["right"] +. 12.0, "y": rect["top"] +. rect["height"] /. 2.0})
    | None => ()
    }
    setIsVisible(_ => true)
  }

  let handleMouseLeave = () => {
    setIsVisible(_ => false)
  }

  // Container style
  let containerStyle = ReactDOM.Style.make(
    ~position="relative",
    ~display="inline-flex",
    ~alignItems="center",
    (),
  )

  // Info icon style
  let iconStyle = ReactDOM.Style.make(
    ~width="16px",
    ~height="16px",
    ~borderRadius="50%",
    ~backgroundColor="#2a2a2a",
    ~border="1px solid #3a3a3a",
    ~color="#666",
    ~fontSize="10px",
    ~fontWeight="600",
    ~display="flex",
    ~alignItems="center",
    ~justifyContent="center",
    ~cursor="help",
    ~transition="all 0.2s ease",
    ~marginLeft="8px",
    (),
  )

  // Popover content style
  let popoverStyle = ReactDOM.Style.make(
    ~position="fixed",
    ~width="280px",
    ~padding="16px",
    ~backgroundColor="#1a1a1a",
    ~border="1px solid #2a2a2a",
    ~borderRadius="8px",
    ~boxShadow="0 4px 20px rgba(0, 0, 0, 0.5)",
    ~zIndex="9999",
    ~opacity=isVisible ? "1" : "0",
    ~visibility=isVisible ? "visible" : "hidden",
    ~transition="opacity 0.2s ease, visibility 0.2s ease",
    ~pointerEvents="none",
    ~left=position["x"]->Js.Float.toString ++ "px",
    ~top=position["y"]->Js.Float.toString ++ "px",
    ~transform="translateY(-50%)",
    (),
  )

  // Popover title style
  let titleStyle = ReactDOM.Style.make(
    ~fontSize="12px",
    ~fontWeight="600",
    ~color="#ccc",
    ~marginBottom="8px",
    (),
  )

  // Popover text style
  let textStyle = ReactDOM.Style.make(
    ~fontSize="11px",
    ~color="#888",
    ~lineHeight="1.5",
    (),
  )

  // CSS for pseudo-elements (arrow pointer) - using a wrapper div
  let arrowBeforeStyle = ReactDOM.Style.make(
    ~position="absolute",
    ~left="-6px",
    ~top="50%",
    ~transform="translateY(-50%)",
    ~width="0",
    ~height="0",
    ~borderTop="6px solid transparent",
    ~borderBottom="6px solid transparent",
    ~borderRight="6px solid #2a2a2a",
    (),
  )

  let arrowAfterStyle = ReactDOM.Style.make(
    ~position="absolute",
    ~left="-5px",
    ~top="50%",
    ~transform="translateY(-50%)",
    ~width="0",
    ~height="0",
    ~borderTop="5px solid transparent",
    ~borderBottom="5px solid transparent",
    ~borderRight="5px solid #1a1a1a",
    (),
  )

  let popoverContent =
    <div style={popoverStyle}>
      <div style={arrowBeforeStyle} />
      <div style={arrowAfterStyle} />
      <div style={titleStyle}> {title->React.string} </div>
      <div style={textStyle}> {content->React.string} </div>
    </div>

  <div
    style={containerStyle}
    onMouseEnter={_ => handleMouseEnter()}
    onMouseLeave={_ => handleMouseLeave()}>
    <div
      ref={ReactDOM.Ref.domRef(iconRef)}
      style={iconStyle}
      className="info-icon">
      {"i"->React.string}
    </div>
    {createPortal(popoverContent, body)}
  </div>
}
