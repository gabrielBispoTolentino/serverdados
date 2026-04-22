import { pool } from "../config/database";
import express from "express";

const router = express.Router();

router.post("/pagamentos", async (req, res) => {
  const { valor, id_admin } = req.body;

  if (!valor || !id_admin) {
    return res.status(400).json({ message: "valor e id_admin são obrigatórios" });
  }

  try {
    const [result] = await pool.query(
      "INSERT INTO pagamentos (valor, id_admin) VALUES (?, ?)",
      [valor, id_admin]
    );
    res.status(201).json({ message: "Pagamento registrado com sucesso" });
  } catch (error) {
    console.error("Erro ao registrar pagamento:", error);
    res.status(500).json({ message: "Erro ao registrar pagamento" });
  }
});

router.get("/pagamentos/:id_admin", async (req, res) => {
  const { id_admin } = req.params;

  try {
    const [rows] = await pool.query(
      "SELECT * FROM pagamentos WHERE id_admin = ?",
      [id_admin]
    );
    res.json(rows);
  } catch (error) {
    console.error("Erro ao buscar pagamentos:", error);
    res.status(500).json({ message: "Erro ao buscar pagamentos" });
  }
});

router.post("/pagamentos/:id/confirmar", async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query(
      "UPDATE pagamentos SET pago = TRUE WHERE id = ?",
      [id]
    );

    const affectedRows = (result as unknown as { affectedRows: number }).affectedRows;

    if (affectedRows === 0) {
      return res.status(404).json({ message: "Pagamento não encontrado" });
    }

    res.json({ message: "Pagamento confirmado com sucesso" });
  } catch (error) {
    console.error("Erro ao confirmar pagamento:", error);
    res.status(500).json({ message: "Erro ao confirmar pagamento" });
  }
});

export default router;