import { fireEvent, render, screen, within } from "@testing-library/react";
import { AnatomyCardsSection } from "@n-apt/learn/sidebar/AnatomyCardsSection";

jest.mock("@n-apt/three-d/public/useModel3D", () => {
  const mockSetSelectedArea = jest.fn();
  const mockSetModelVariant = jest.fn();
  return {
    mockSetSelectedArea,
    mockSetModelVariant,
    useModel3D: () => ({
      selectedArea: null,
      setSelectedArea: mockSetSelectedArea,
      setModelVariant: mockSetModelVariant,
    }),
  };
});

const model3DMock = jest.requireMock("@n-apt/three-d/public/useModel3D") as {
  mockSetSelectedArea: jest.Mock;
  mockSetModelVariant: jest.Mock;
};

describe("anatomy card related areas", () => {
  beforeEach(() => {
    model3DMock.mockSetSelectedArea.mockClear();
    model3DMock.mockSetModelVariant.mockClear();
  });

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

  test("selects and focuses a nasal sensory nerve card", () => {
    render(<AnatomyCardsSection kind="nervous" searchTerm="nasal sensory nerves" />);

    fireEvent.click(screen.getByRole("button", { name: /^Nasal sensory nerves/ }));

    expect(model3DMock.mockSetSelectedArea).toHaveBeenCalledWith(expect.objectContaining({
      name: "Nasal sensory nerves (V1/V2)",
      highlightType: "nerve",
      target: expect.any(Array),
    }));
    expect(model3DMock.mockSetModelVariant).toHaveBeenCalledWith("anatomy");
  });
});
