#ifndef MAINWINDOW_H
#define MAINWINDOW_H
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QGridLayout>
#include <QLabel>
#include <QComboBox>
#include <QPushButton>
#include <QLineEdit>
#include <QSpinBox>
#include <QDoubleSpinBox>
#include <QGroupBox>
#include <QTableWidget>
#include <QTableWidgetItem>
#include "Client.h"
#include <QMainWindow>

class MainWindow : public QMainWindow {
        Q_OBJECT

    public:
        explicit MainWindow(QWidget* parent = nullptr);
        ~MainWindow();
    private slots:
        void populateAccounts();
        void onAccountSelected(const QString& text);
		void onDisconnectClicked();
    private:
        
        QComboBox* accountDropdown;
        void setupUi();
		Client* client; // Pointer to the Client object for handling WebSocket communication
       
};

#endif // MAINWINDOW_H