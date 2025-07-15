#ifndef MAINWINDOW_H
#define MAINWINDOW_H
#include "client.h"
#include <QMainWindow>

class MainWindow : public QMainWindow
{
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);
    ~MainWindow();
private:
    T4Client *client;
};

#endif // MAINWINDOW_H
