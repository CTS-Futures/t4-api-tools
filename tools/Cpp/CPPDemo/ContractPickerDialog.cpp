#include "ContractPickerDialog.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QHeaderView>

ContractPickerDialog::ContractPickerDialog(QWidget* parent)
    : QDialog(parent) {
    setWindowTitle("Select a Contract");
    setMinimumSize(400, 500);

    QVBoxLayout* mainLayout = new QVBoxLayout(this);

    searchEdit = new QLineEdit();
    searchEdit->setPlaceholderText("Search contracts...");
    mainLayout->addWidget(searchEdit);

    tree = new QTreeWidget();
    tree->setHeaderHidden(true);
    tree->setSelectionMode(QAbstractItemView::SingleSelection);
    mainLayout->addWidget(tree);

    // Buttons
    QHBoxLayout* buttonLayout = new QHBoxLayout();
    cancelBtn = new QPushButton("Cancel");
    selectBtn = new QPushButton("Select");
    selectBtn->setEnabled(false); // until selection is made

    buttonLayout->addStretch();
    buttonLayout->addWidget(cancelBtn);
    buttonLayout->addWidget(selectBtn);
    mainLayout->addLayout(buttonLayout);

    // Sample data
    QStringList groups = {
        "CBOT Commodity Futures", "CBOT Commodity Options",
        "CBOT Equity Futures", "CBOT Equity Options",
        "CBOT Financial Futures", "CBOT Financial Options",
        "CFE", "CME Agricultural Futures"
    };
    for (const QString& group : groups) {
        auto* parent = new QTreeWidgetItem(tree);
        parent->setText(0, group);
        parent->setExpanded(false);
        for (int i = 1; i <= 3; ++i) {
            auto* child = new QTreeWidgetItem(parent);
            child->setText(0, group + QString(" - Contract %1").arg(i));
        }
    }

    connect(searchEdit, &QLineEdit::textChanged, this, &ContractPickerDialog::filterContracts);
    connect(cancelBtn, &QPushButton::clicked, this, &QDialog::reject);
    connect(selectBtn, &QPushButton::clicked, this, [this]() {
        if (auto* item = tree->currentItem()) {
            emit contractSelected(item->text(0));
            accept();
        }
        });
    connect(tree, &QTreeWidget::itemDoubleClicked, this, &ContractPickerDialog::onItemDoubleClicked);
    connect(tree, &QTreeWidget::itemSelectionChanged, this, [this]() {
        auto* item = tree->currentItem();
        selectBtn->setEnabled(item && item->childCount() == 0);
        });
}

void ContractPickerDialog::filterContracts(const QString& text) {
    for (int i = 0; i < tree->topLevelItemCount(); ++i) {
        auto* parent = tree->topLevelItem(i);
        bool parentVisible = false;
        for (int j = 0; j < parent->childCount(); ++j) {
            auto* child = parent->child(j);
            bool match = child->text(0).contains(text, Qt::CaseInsensitive);
            child->setHidden(!match);
            parentVisible |= match;
        }
        parent->setHidden(!parentVisible);
    }
}

void ContractPickerDialog::onItemDoubleClicked(QTreeWidgetItem* item, int column) {
    if (item->childCount() == 0) {
        emit contractSelected(item->text(0));
        accept();
    }
}
