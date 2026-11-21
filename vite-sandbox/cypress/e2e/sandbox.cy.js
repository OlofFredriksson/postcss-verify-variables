describe("Vite sandbox", () => {
    it("renders the FKUI button and updates the counter", () => {
        cy.visit("/");
        cy.contains("h1", "Vite sandbox").should("be.visible");
        cy.contains("p", "Knappen har klickats 0 gånger.").should("be.visible");
        cy.contains("button", "Klicka här").should("be.visible").click();
        cy.contains("p", "Knappen har klickats 1 gånger.").should("be.visible");
    });
});
