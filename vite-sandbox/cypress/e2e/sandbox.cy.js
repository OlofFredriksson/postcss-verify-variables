describe("Vite sandbox", () => {
    it("renders the FKUI button and updates the counter", () => {
        cy.visit("/");
        cy.contains("h1", "Vite sandbox").should("be.visible");
        cy.contains("p", "Button clicks: 0").should("be.visible");
        cy.contains("button", "Click here").should("be.visible").click();
        cy.contains("p", "Button clicks: 1").should("be.visible");
    });
});
