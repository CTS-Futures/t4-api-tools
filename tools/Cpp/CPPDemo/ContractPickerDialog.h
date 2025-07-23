#pragma once
#include <QDialog>
#include <QTreeWidget>
#include <QLineEdit>
#include <QPushButton>

class ContractPickerDialog : public QDialog {
    Q_OBJECT
public:
    explicit ContractPickerDialog(QWidget* parent = nullptr);

signals:
    void contractSelected(const QString& contractId);

private slots:
    void filterContracts(const QString& text);
    void onItemDoubleClicked(QTreeWidgetItem* item, int column);

private:
    QLineEdit* searchEdit;
    QTreeWidget* tree;
    QPushButton* selectBtn;
    QPushButton* cancelBtn;
};
