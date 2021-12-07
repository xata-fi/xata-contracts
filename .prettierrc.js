module.exports = {
  semi: true,
  trailingComma: "all",
  singleQuote: true,
  printWidth: 120,
  tabWidth: 2,
  useTabs: false,
  overrides: [
    {
      files: "*.sol",
      options: {
        tabWidth: 4,
        singleQuote: false,
        explicitTypes: "always"
      }
    }
  ]
};