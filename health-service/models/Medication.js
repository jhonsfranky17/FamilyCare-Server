const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

const Medication = sequelize.define(
  "Medication",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    patient_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    dosage: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    schedule: {
      type: DataTypes.TIME,
      allowNull: false,
    },
    frequency: {
      type: DataTypes.ENUM("daily", "weekly"),
      defaultValue: "daily",
    },
    status: {
      type: DataTypes.ENUM("active", "completed", "stopped"),
      defaultValue: "active",
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    version: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
  },
  {
    tableName: "medications",
    timestamps: false,
    indexes: [
      {
        fields: ["schedule"],
      },
    ],
  },
);

module.exports = Medication;
