import React from "react";
import DOMPurify from "dompurify";

function styleStringToObject(style: string): Record<string, string> {
  return style.split(";").reduce<Record<string, string>>((result, declaration) => {
    const separator = declaration.indexOf(":");
    if (separator === -1) return result;

    const property = declaration.slice(0, separator).trim();
    const value = declaration.slice(separator + 1).trim();
    if (!property || !value) return result;

    const reactProperty = property.startsWith("--")
      ? property
      : property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    result[reactProperty] = value;
    return result;
  }, {});
}

function nodeToReact(node: Node, key: string): React.ReactNode {
  if (node.nodeType === 3) return node.nodeValue;
  if (node.nodeType !== 1) return null;

  const element = node as Element;
  const props: Record<string, unknown> = { key };
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (name.startsWith("on")) continue;

    if (name === "class") props.className = attribute.value;
    else if (name === "for") props.htmlFor = attribute.value;
    else if (name === "style") props.style = styleStringToObject(attribute.value);
    else props[attribute.name] = attribute.value;
  }

  const children = Array.from(element.childNodes).map((child, index) =>
    nodeToReact(child, `${key}-${index}`),
  );
  const voidElements = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  if (voidElements.has(element.tagName.toLowerCase())) {
    return React.createElement(element.tagName.toLowerCase(), props);
  }
  return React.createElement(element.tagName.toLowerCase(), props, children);
}

/**
 * Sanitizes an HTML fragment and converts it to React elements.
 * This intentionally avoids dangerouslySetInnerHTML so event attributes and
 * parser-injected elements cannot become live DOM nodes.
 */
export function safeHtmlToReactNodes(html: string): React.ReactNode {
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    FORBID_TAGS: ["embed", "iframe", "img", "object", "script", "style"],
    RETURN_TRUSTED_TYPE: false,
  });

  if (typeof DOMParser === "undefined") return html;
  const document = new DOMParser().parseFromString(sanitized, "text/html");
  return Array.from(document.body.childNodes).map((node, index) =>
    nodeToReact(node, `safe-html-${index}`),
  );
}
