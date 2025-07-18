#pragma once

#include <QtWidgets/QMainWindow>
#include "ui_cppdemo.h"
#include "client.h"
class CPPDemo : public QMainWindow
{
    Q_OBJECT

public:
    CPPDemo(QWidget *parent = nullptr);
    ~CPPDemo();

private:
    Ui::CPPDemoClass ui;

};

