// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductCard } from "@/components/product-card";

describe("ProductCard", () => {
  it("renders the title, shop name, and a link to the product", () => {
    render(
      <ProductCard
        title="Cool Shirt"
        shopName="Shop Test"
        productUrl="https://shop.test/products/cool-shirt"
        imageUrl={null}
        firstSeenAt={new Date()}
      />,
    );

    expect(screen.getByText("Cool Shirt")).toBeInTheDocument();
    expect(screen.getByText("Shop Test")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://shop.test/products/cool-shirt",
    );
  });

  it("shows a placeholder when there is no image", () => {
    render(
      <ProductCard
        title="Cool Shirt"
        shopName="Shop Test"
        productUrl="https://shop.test/products/cool-shirt"
        imageUrl={null}
        firstSeenAt={new Date()}
      />,
    );

    expect(screen.getByText(/no image/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
