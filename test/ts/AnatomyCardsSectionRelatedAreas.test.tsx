import { render, screen, within } from "@testing-library/react";
import { AnatomyCardsSection } from "@n-apt/learn/sidebar/AnatomyCardsSection";

jest.mock("@n-apt/three-d/public/useModel3D", () => ({
  useModel3D: () => ({
    selectedArea: null,
    setSelectedArea: jest.fn(),
    setModelVariant: jest.fn(),
  }),
}));

describe("anatomy card related areas", () => {
  test("keeps both brain and peripheral nerve links for intrinsic hand muscles", () => {
    render(<AnatomyCardsSection kind="nervous" searchTerm="intrinsic hand muscles" />);

    const cardButton = screen.getByRole("button", { name: /^Intrinsic hand muscles\b/ });
    const card = within(cardButton.parentElement as HTMLElement);

    expect(card.getByText("Posterior parietal cortex")).toBeInTheDocument();
    expect(card.getByText("Ulnar nerve")).toBeInTheDocument();
  });

  test("keeps the facial nerve and facial-expression context for zygomaticus major", () => {
    render(<AnatomyCardsSection kind="nervous" searchTerm="zygomaticus major" />);

    const cardButton = screen.getByRole("button", { name: /^Zygomaticus major\b/ });
    const card = within(cardButton.parentElement as HTMLElement);

    expect(card.getByText("Orbicularis oculi")).toBeInTheDocument();
    expect(card.getByText("Cranial nerve VII Facial")).toBeInTheDocument();
  });
});
